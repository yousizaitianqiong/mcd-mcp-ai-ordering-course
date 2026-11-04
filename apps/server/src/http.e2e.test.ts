import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHttpServer } from "./http.js";
import type { AppConfig } from "./config.js";
import { OrderingOrchestrator } from "./orchestrator.js";
import { MockFoodOrderProvider } from "./providers/mock.js";
import { JsonStore } from "./store.js";
import type { AgentEvent, CartItem, MenuItem, OrderContext, PendingOrder } from "./types.js";

class CountingMockProvider extends MockFoodOrderProvider {
  createOrderCalls = 0;

  override async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
    this.createOrderCalls += 1;
    return super.createOrder(input);
  }
}

type JsonResult = { response: Response; body: Record<string, unknown> };

async function postJson(baseUrl: string, route: string, body: Record<string, unknown>): Promise<JsonResult> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

function parseSse(text: string): AgentEvent[] {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const type = block.match(/^event:\s*(.+)$/m)?.[1];
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!type || !data) return [];
    return [{ type: type as AgentEvent["type"], data: JSON.parse(data) }];
  });
}

function eventData<T>(events: AgentEvent[], type: AgentEvent["type"]): T {
  const event = events.find((candidate) => candidate.type === type);
  assert.ok(event, `缺少 SSE 事件 ${type}`);
  return event.data as T;
}

async function startMockServer(run: (input: {
  baseUrl: string;
  store: JsonStore;
  provider: CountingMockProvider;
  stateFile: string;
}) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-http-e2e-"));
  const stateFile = path.join(directory, "state.json");
  const store = new JsonStore(stateFile);
  await store.load();
  const provider = new CountingMockProvider();
  const orchestrator = new OrderingOrchestrator(provider, store);
  const config: AppConfig = {
    port: 0,
    origin: "http://localhost:5173",
    mode: "mock",
    dataFile: stateFile,
    mcdUrl: "https://mcp.mcd.cn",
    mcdProtocolVersion: "2025-06-18",
    mcdMoneyUnit: "yuan",
    modelMaxTurns: 8,
  };
  const server = createHttpServer({
    config,
    store,
    provider,
    orchestrator,
    modelConfigured: false,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    await run({ baseUrl: `http://127.0.0.1:${address.port}`, store, provider, stateFile });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("Mock HTTP 端到端覆盖菜单、购物车、核价、确认、状态和重复确认保护", async () => {
  await startMockServer(async ({ baseUrl, store, provider, stateFile }) => {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const healthText = await healthResponse.text();
    const health = JSON.parse(healthText) as Record<string, unknown>;
    assert.equal(healthResponse.status, 200);
    assert.equal(health.mode, "mock");
    assert.equal(health.provider, "mock");
    assert.equal(health.modelConfigured, false);
    assert.equal(health.mcpConfigured, false);
    assert.equal(healthText.includes("Token"), false);

    const firstChatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "查询菜单" }),
    });
    const firstChatEvents = parseSse(await firstChatResponse.text());
    assert.equal(firstChatResponse.status, 200);
    const sessionId = eventData<{ sessionId: string }>(firstChatEvents, "session").sessionId;
    const menu = eventData<MenuItem[]>(firstChatEvents, "menu");
    assert.equal(menu.length, 4);
    assert.equal(firstChatEvents.some((event) => event.type === "addresses"), true);
    assert.equal(firstChatEvents.some((event) => event.type === "stores"), true);
    assert.equal(firstChatEvents.at(-1)?.type, "done");

    const cartResult = await postJson(baseUrl, "/api/cart", {
      sessionId,
      item: {
        productCode: menu[0].productCode,
        productName: menu[0].name,
        unitPrice: menu[0].price,
        quantity: 1,
      },
    });
    assert.equal(cartResult.response.status, 200);
    assert.equal((cartResult.body.cart as Array<{ productCode: string }>)[0].productCode, menu[0].productCode);

    const invalidItemResult = await postJson(baseUrl, "/api/cart", {
      sessionId,
      item: { productCode: "mock-meal-disabled", productName: "失效餐品", unitPrice: 1, quantity: 1 },
    });
    assert.equal(invalidItemResult.response.status, 400);
    assert.equal((invalidItemResult.body.error as { code: string }).code, "ITEM_NOT_IN_MENU");

    const quoteResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: "请核价当前购物车" }),
    });
    const quoteEvents = parseSse(await quoteResponse.text());
    const approval = eventData<{ approvalId: string; quoteHash: string; totalPrice: number }>(quoteEvents, "confirmation_required");
    assert.equal(quoteResponse.status, 200);
    assert.equal(approval.totalPrice, 27);
    assert.ok(approval.approvalId);
    assert.ok(approval.quoteHash);
    assert.equal(store.summary().orders, 0);

    const confirmResult = await postJson(baseUrl, "/api/orders/confirm", {
      sessionId,
      approvalId: approval.approvalId,
      quoteHash: approval.quoteHash,
    });
    const order = confirmResult.body.order as PendingOrder;
    assert.equal(confirmResult.response.status, 200);
    assert.match(order.orderId, /^MOCK-ORDER-/);
    assert.equal(order.orderStatus, "待支付（模拟）");
    assert.match(order.payH5Url || "", /^https:\/\/example\.invalid\//);
    assert.equal(provider.createOrderCalls, 1);
    assert.equal(store.summary().orders, 1);

    const duplicateResult = await postJson(baseUrl, "/api/orders/confirm", {
      sessionId,
      approvalId: approval.approvalId,
      quoteHash: approval.quoteHash,
    });
    assert.equal(duplicateResult.response.status, 409);
    assert.equal((duplicateResult.body.error as { code: string }).code, "APPROVAL_ALREADY_USED");
    assert.equal(provider.createOrderCalls, 1);

    const statusResponse = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(order.orderId)}`);
    const statusBody = await statusResponse.json() as { order: PendingOrder };
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(statusBody.order, order);

    const persisted = await fs.readFile(stateFile, "utf8");
    assert.equal(persisted.includes("成都市高新区课程演示路 1 号"), false);
    assert.equal(persisted.includes("138****0000"), false);
    assert.equal(persisted.includes("course-demo-pay"), false);
  });
});

test("购物车支持数量边界、删除单项、状态读取和报价失效", async () => {
  await startMockServer(async ({ baseUrl, provider }) => {
    async function chat(message: string, sessionId?: string): Promise<AgentEvent[]> {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, message }),
      });
      return parseSse(await response.text());
    }
    const first = await chat("查询菜单");
    const sessionId = eventData<{ sessionId: string }>(first, "session").sessionId;
    const menu = eventData<MenuItem[]>(first, "menu");
    for (const item of menu.slice(0, 2)) {
      const result = await postJson(baseUrl, "/api/cart", { sessionId, item: {
        productCode: item.productCode, productName: item.name, unitPrice: item.price, quantity: 1,
      } });
      assert.equal(result.response.status, 200);
    }
    const oldQuote = eventData<{ approvalId: string; quoteHash: string }>(await chat("请核价当前购物车", sessionId), "confirmation_required");
    const high = await postJson(baseUrl, "/api/cart", { sessionId, action: "update", productCode: menu[0].productCode, quantity: 21 });
    assert.equal(high.response.status, 200);
    assert.equal((high.body.cart as CartItem[])[0].quantity, 20);
    assert.match(String(high.body.notice), /1 至 20/);
    const stale = await postJson(baseUrl, "/api/orders/confirm", { sessionId, ...oldQuote });
    assert.equal(stale.response.status, 409);
    assert.equal((stale.body.error as { code: string }).code, "QUOTE_STALE");
    assert.equal(provider.createOrderCalls, 0);
    const low = await postJson(baseUrl, "/api/cart", { sessionId, action: "update", productCode: menu[0].productCode, quantity: 0 });
    assert.equal((low.body.cart as CartItem[])[0].quantity, 1);
    assert.ok(low.body.notice);
    const huge = await postJson(baseUrl, "/api/cart", { sessionId, action: "update", productCode: menu[0].productCode, quantity: 1e20 });
    assert.equal((huge.body.cart as CartItem[])[0].quantity, 20);
    assert.ok(huge.body.notice);
    const invalid = await postJson(baseUrl, "/api/cart", { sessionId, action: "update", productCode: menu[0].productCode, quantity: 1.5 });
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as { code: string }).code, "INVALID_QUANTITY");
    const missing = await postJson(baseUrl, "/api/cart", { sessionId, action: "remove", productCode: "missing" });
    assert.equal(missing.response.status, 400);
    const removed = await postJson(baseUrl, "/api/cart", { sessionId, action: "remove", productCode: menu[0].productCode });
    assert.deepEqual((removed.body.cart as CartItem[]).map((item) => item.productCode), [menu[1].productCode]);
    const last = await postJson(baseUrl, "/api/cart", { sessionId, action: "remove", productCode: menu[1].productCode });
    assert.deepEqual(last.body.cart, []);
    const view = await postJson(baseUrl, "/api/cart", { sessionId, action: "view" });
    assert.deepEqual(view.body.cart, []);
  });
});
