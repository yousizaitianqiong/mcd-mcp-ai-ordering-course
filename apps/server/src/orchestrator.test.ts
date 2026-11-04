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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("核价过程中修改购物车时不生成可确认的旧报价", async () => {
  const started = deferred();
  const release = deferred();
  class SlowPriceProvider extends CountingProvider {
    slow = false;
    override async calculatePrice(input: { context: OrderContext; items: CartItem[] }): Promise<PriceQuote> {
      if (this.slow) { started.resolve(); await release.promise; }
      return super.calculatePrice(input);
    }
  }
  const provider = new SlowPriceProvider();
  const fixture = await createFixture(provider);
  try {
    const first = await getApproval(fixture.orchestrator);
    provider.slow = true;
    const events: Array<{ type: string; data: unknown }> = [];
    const pricing = fixture.orchestrator.chat(first.sessionId, "请核价当前购物车", (event) => events.push(event));
    await started.promise;
    const session = await fixture.store.getSession(first.sessionId);
    await fixture.store.setCart(first.sessionId, session.cart.map((item) => ({ ...item, quantity: 2 })));
    release.resolve();
    await pricing;
    assert.equal(events.some((event) => event.type === "confirmation_required"), false);
    assert.equal((events.find((event) => event.type === "error")?.data as { code: string }).code, "QUOTE_STALE");
    await assert.rejects(() => fixture.orchestrator.confirmOrder(first.sessionId, first.approvalId, first.quoteHash),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_STALE");
    assert.equal(provider.createOrderCalls, 0);
  } finally {
    release.resolve();
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("查询菜单期间切换门店时不把旧门店餐品加入新购物车", async () => {
  const started = deferred();
  const release = deferred();
  class SlowMenuProvider extends CountingProvider {
    slow = false;
    override async listMeals(input: Parameters<MockFoodOrderProvider["listMeals"]>[0]) {
      if (this.slow) { started.resolve(); await release.promise; }
      return super.listMeals(input);
    }
  }
  const provider = new SlowMenuProvider();
  const fixture = await createFixture(provider);
  try {
    const quote = await getApproval(fixture.orchestrator);
    provider.slow = true;
    const events: Array<{ type: string; data: unknown }> = [];
    const chat = fixture.orchestrator.chat(quote.sessionId, "我想吃香辣鸡翅", (event) => events.push(event));
    await started.promise;
    const session = await fixture.store.getSession(quote.sessionId);
    assert.ok(session.context);
    await fixture.store.setContext(quote.sessionId, { ...session.context, storeCode: "another-store" });
    release.resolve();
    await chat;
    assert.equal((events.find((event) => event.type === "error")?.data as { code: string }).code, "CART_CHANGED");
    assert.deepEqual((await fixture.store.getSession(quote.sessionId)).cart, []);
  } finally {
    release.resolve();
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("切换配送上下文清空购物车并拒绝旧报价", async () => {
  const fixture = await createFixture();
  try {
    const quote = await getApproval(fixture.orchestrator);
    const session = await fixture.store.getSession(quote.sessionId);
    assert.ok(session.context);
    const updated = await fixture.store.setContext(quote.sessionId, { ...session.context, storeCode: "another-store" });
    assert.deepEqual(updated.cart, []);
    await assert.rejects(() => fixture.orchestrator.confirmOrder(quote.sessionId, quote.approvalId, quote.quoteHash),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_STALE");
    assert.equal(fixture.provider.createOrderCalls, 0);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("订单提交期间禁止修改购物车和配送上下文", async () => {
  const started = deferred();
  const release = deferred();
  class SlowOrderProvider extends CountingProvider {
    override async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
      started.resolve();
      await release.promise;
      return super.createOrder(input);
    }
  }
  const provider = new SlowOrderProvider();
  const fixture = await createFixture(provider);
  try {
    const quote = await getApproval(fixture.orchestrator);
    const session = await fixture.store.getSession(quote.sessionId);
    assert.ok(session.context);
    const confirming = fixture.orchestrator.confirmOrder(quote.sessionId, quote.approvalId, quote.quoteHash);
    await started.promise;
    await assert.rejects(() => fixture.store.setCart(quote.sessionId, []),
      (error: unknown) => error instanceof AppError && error.code === "ORDER_SUBMITTING");
    await assert.rejects(() => fixture.store.setContext(quote.sessionId, session.context!),
      (error: unknown) => error instanceof AppError && error.code === "ORDER_SUBMITTING");
    release.resolve();
    await confirming;
    assert.deepEqual((await fixture.store.getSession(quote.sessionId)).cart, []);
    assert.equal(provider.createOrderCalls, 1);
  } finally {
    release.resolve();
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("加载旧数据时旧待确认报价失效且中断提交标记为未知", async () => {
  const fixture = await createFixture();
  try {
    const quote = await getApproval(fixture.orchestrator);
    const file = path.join(fixture.directory, "state.json");
    const state = JSON.parse(await fs.readFile(file, "utf8"));
    delete state.sessions[quote.sessionId].revision;
    delete state.approvals[quote.approvalId].revision;
    state.approvals.interrupted = { ...state.approvals[quote.approvalId], approvalId: "interrupted", status: "submitting" };
    state.approvals.partial = { ...state.approvals[quote.approvalId], approvalId: "partial", revision: 0 };
    await fs.writeFile(file, JSON.stringify(state), "utf8");
    const restored = new JsonStore(file);
    await restored.load();
    assert.equal((await restored.getApproval(quote.approvalId))?.status, "invalidated");
    assert.equal((await restored.getApproval("interrupted"))?.status, "unknown");
    assert.equal((await restored.getApproval("partial"))?.status, "invalidated");
    assert.equal((await restored.getSession(quote.sessionId)).revision, 0);
    await assert.rejects(() => restored.claimApproval(quote.sessionId, quote.approvalId, quote.quoteHash),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_STALE");
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});
