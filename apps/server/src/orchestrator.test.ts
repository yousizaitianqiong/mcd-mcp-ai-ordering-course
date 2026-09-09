import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { AppError } from "./errors.js";
import type { LlmMessage, LlmTool, ModelAdapter } from "./model.js";
import { OrderingOrchestrator } from "./orchestrator.js";
import { MockFoodOrderProvider } from "./providers/mock.js";
import { JsonStore } from "./store.js";
import type { CartItem, OrderContext, PendingOrder, PriceQuote } from "./types.js";

class CountingProvider extends MockFoodOrderProvider {
  createOrderCalls = 0;
  failureCode?: string;

  override async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
    this.createOrderCalls += 1;
    if (this.failureCode) throw new AppError(this.failureCode, "模拟下游错误", 504);
    return super.createOrder(input);
  }
}

class ExpiredQuoteProvider extends CountingProvider {
  override async calculatePrice(input: { context: OrderContext; items: CartItem[] }): Promise<PriceQuote> {
    const quote = await super.calculatePrice(input);
    return { ...quote, expiresAt: new Date(Date.now() - 1_000).toISOString() };
  }
}

async function createFixture(provider = new CountingProvider()): Promise<{
  store: JsonStore;
  orchestrator: OrderingOrchestrator;
  provider: CountingProvider;
  directory: string;
}> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-ordering-test-"));
  const store = new JsonStore(path.join(directory, "state.json"));
  await store.load();
  return { store, orchestrator: new OrderingOrchestrator(provider, store), provider, directory };
}

async function getApproval(orchestrator: OrderingOrchestrator): Promise<{ sessionId: string; approvalId: string; quoteHash: string }> {
  const events: Array<{ type: string; data: unknown }> = [];
  await orchestrator.chat(undefined, "我想吃麦香鸡套餐", (event) => events.push(event));
  const sessionId = String((events.find((event) => event.type === "session")?.data as { sessionId: string }).sessionId);
  const quote = events.find((event) => event.type === "confirmation_required")?.data as { approvalId: string; quoteHash: string };
  assert.ok(quote?.approvalId);
  assert.ok(quote?.quoteHash);
  return { sessionId, approvalId: quote.approvalId, quoteHash: quote.quoteHash };
}

test("确认链路校验报价哈希且成功后不可重放", async () => {
  const fixture = await createFixture();
  try {
    const approval = await getApproval(fixture.orchestrator);
    await assert.rejects(
      () => fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, "tampered-hash"),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_HASH_MISMATCH",
    );
    assert.equal(fixture.provider.createOrderCalls, 0);
    const order = await fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, approval.quoteHash);
    assert.equal(order.orderStatus, "待支付（模拟）");
    assert.equal(fixture.provider.createOrderCalls, 1);
    const persisted = await fs.readFile(path.join(fixture.directory, "state.json"), "utf8");
    assert.equal(persisted.includes("raw"), false);
    assert.equal(persisted.includes("成都市高新区课程演示路 1 号"), false);
    assert.equal(persisted.includes("payH5Url"), false);
    await assert.rejects(
      () => fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, approval.quoteHash),
      (error: unknown) => error instanceof AppError && error.code === "APPROVAL_ALREADY_USED",
    );
    assert.equal(fixture.provider.createOrderCalls, 1);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("并发确认最多进入一次 create-order", async () => {
  const fixture = await createFixture();
  try {
    const approval = await getApproval(fixture.orchestrator);
    const results = await Promise.allSettled([
      fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, approval.quoteHash),
      fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, approval.quoteHash),
    ]);
    assert.equal(fixture.provider.createOrderCalls, 1);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("超时或网络不确定状态进入终态且禁止重试", async () => {
  const provider = new CountingProvider();
  provider.failureCode = "MCP_TIMEOUT";
  const fixture = await createFixture(provider);
  try {
    const approval = await getApproval(fixture.orchestrator);
    await assert.rejects(
      () => fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, approval.quoteHash),
      (error: unknown) => error instanceof AppError && error.code === "MCP_TIMEOUT",
    );
    assert.equal(provider.createOrderCalls, 1);
    await assert.rejects(
      () => fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, approval.quoteHash),
      (error: unknown) => error instanceof AppError && error.code === "APPROVAL_NOT_RETRYABLE",
    );
    assert.equal(provider.createOrderCalls, 1);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("报价过期时拒绝确认且不进入 create-order", async () => {
  const provider = new ExpiredQuoteProvider();
  const fixture = await createFixture(provider);
  try {
    const approval = await getApproval(fixture.orchestrator);
    await assert.rejects(
      () => fixture.orchestrator.confirmOrder(approval.sessionId, approval.approvalId, approval.quoteHash),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_EXPIRED",
    );
    assert.equal(provider.createOrderCalls, 0);
    assert.equal((await fixture.store.getApproval(approval.approvalId))?.status, "expired");
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("模型最大回合数来自配置并限制工具循环", async () => {
  const fixture = await createFixture();
  try {
    const loopingModel: ModelAdapter & { calls: number } = {
      name: "test-model",
      calls: 0,
      async chat(_messages: LlmMessage[], _tools: LlmTool[]) {
        this.calls += 1;
        return {
          message: {
            role: "assistant" as const,
            content: null,
            tool_calls: [{ id: `call-${this.calls}`, type: "function" as const, function: { name: "list_delivery_addresses", arguments: "{}" } }],
          },
          finishReason: "tool_calls",
        };
      },
    };
    const limited = new OrderingOrchestrator(fixture.provider, fixture.store, loopingModel, 2);
    await limited.chat(undefined, "查询地址", () => undefined);
    assert.equal(loopingModel.calls, 2);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});
