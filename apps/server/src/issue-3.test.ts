import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MockFoodOrderProvider } from "./providers/mock.js";
import { createModelTools, OrderingOrchestrator } from "./orchestrator.js";
import type { ModelAdapter, LlmMessage, LlmTool, LlmResponse } from "./model.js";
import { JsonStore } from "./store.js";
import type { AgentEvent, CartItem, Coupon, JsonObject, OrderContext, PendingOrder } from "./types.js";
import { toCouponViews, toMealDetailView } from "./views.js";

async function withStore(run: (store: JsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcd-issue-3-"));
  const store = new JsonStore(path.join(directory, "state.json"));
  await store.load();
  try {
    await run(store);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function eventOf(events: AgentEvent[], type: AgentEvent["type"]): AgentEvent | undefined {
  return events.find((event) => event.type === type);
}

class CountingMockProvider extends MockFoodOrderProvider {
  createOrderCalls = 0;

  override async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
    this.createOrderCalls += 1;
    return super.createOrder(input);
  }
}

class UnsafeDisplayProvider extends MockFoodOrderProvider {
  override async getMealDetail(_input: { code: string }): Promise<JsonObject> {
    return {
      code: "safe-meal-code",
      name: "安全套餐",
      description: "只保留可展示的说明",
      image: "javascript:alert('不应发送')",
      supportModify: true,
      rounds: [{
        name: "主食",
        choices: [{ name: "麦香鸡", code: "safe-choice", quantity: 1, secretToken: "不应发送" }],
        raw: { Authorization: "不应发送" },
      }],
      raw: { Authorization: "不应发送", privateAddress: "不应发送" },
    };
  }

  override async listStoreCoupons(): Promise<Coupon[]> {
    return [{
      couponId: "safe-coupon",
      couponCode: "SAFE10",
      title: "安全优惠",
      validPeriod: "Mock 展示",
      products: [{ productCode: "safe-meal-code", productName: "安全套餐" }],
      secretToken: "不应发送",
      raw: { Authorization: "不应发送" },
    } as Coupon & Record<string, unknown>];
  }
}

class ScriptedModel implements ModelAdapter {
  readonly name = "test-model";
  private index = 0;

  constructor(private readonly calls: Array<{ name: string; arguments: Record<string, unknown> }>) {}

  async chat(_messages: LlmMessage[], _tools: LlmTool[]): Promise<LlmResponse> {
    const next = this.calls[this.index++];
    if (!next) return { message: { role: "assistant", content: "已完成查询。" } };
    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: `test-call-${this.index}`,
          type: "function",
          function: { name: next.name, arguments: JSON.stringify(next.arguments) },
        }],
      },
    };
  }
}

test("详情和优惠事件只发送白名单字段", async () => {
  await withStore(async (store) => {
    const orchestrator = new OrderingOrchestrator(
      new UnsafeDisplayProvider(),
      store,
      new ScriptedModel([
        { name: "get_meal_detail", arguments: { storeCode: "store", beCode: "be", code: "safe-meal-code" } },
        { name: "list_store_coupons", arguments: { storeCode: "store", beCode: "be" } },
      ]),
    );
    const events: AgentEvent[] = [];
    await orchestrator.chat(undefined, "查看详情并查询优惠", (event) => events.push(event));

    const detail = eventOf(events, "meal_detail");
    assert.deepEqual(detail?.data, {
      code: "safe-meal-code",
      name: "安全套餐",
      description: "只保留可展示的说明",
      supportModify: true,
      rounds: [{ name: "主食", choices: [{ name: "麦香鸡", code: "safe-choice", quantity: 1 }] }],
    });
    const coupons = eventOf(events, "coupons");
    assert.deepEqual(coupons?.data, [{
      couponId: "safe-coupon",
      couponCode: "SAFE10",
      title: "安全优惠",
      validPeriod: "Mock 展示",
      products: [{ productCode: "safe-meal-code", productName: "安全套餐" }],
    }]);
    assert.doesNotMatch(JSON.stringify(detail?.data), /Authorization|privateAddress|secretToken|raw/);
    assert.doesNotMatch(JSON.stringify(coupons?.data), /Authorization|secretToken|raw/);
  });
});

test("结构异常时安全失败或丢弃不可验证字段", () => {
  assert.throws(
    () => toMealDetailView({ code: "", name: "", raw: { Authorization: "secret" } }),
    /格式不完整/,
  );
  assert.deepEqual(toCouponViews({ coupons: [{ couponId: "secret" }] }), []);
  assert.deepEqual(toCouponViews([
    { couponId: "ok", couponCode: "OK", title: "可用", products: [{ productCode: "", productName: "" }] },
    { couponId: "bad", title: "缺少编码", raw: { Authorization: "secret" } },
  ]), [{ couponId: "ok", couponCode: "OK", title: "可用" }]);
});

test("Mock 主流程覆盖菜单、详情、优惠、加购、核价和人工确认闸门", async () => {
  await withStore(async (store) => {
    const provider = new CountingMockProvider();
    const orchestrator = new OrderingOrchestrator(provider, store);
    const menuEvents: AgentEvent[] = [];
    const sessionId = await orchestrator.chat(undefined, "展示当前菜单", (event) => menuEvents.push(event));
    assert.ok(eventOf(menuEvents, "menu"));
    assert.ok(eventOf(menuEvents, "addresses"));
    assert.ok(eventOf(menuEvents, "stores"));

    const detailEvents: AgentEvent[] = [];
    await orchestrator.chat(sessionId, "查看麦香鸡套餐详情", (event) => detailEvents.push(event));
    assert.ok(eventOf(detailEvents, "meal_detail"));

    const couponEvents: AgentEvent[] = [];
    await orchestrator.chat(sessionId, "查询当前门店优惠券", (event) => couponEvents.push(event));
    assert.ok(eventOf(couponEvents, "coupons"));

    const quoteEvents: AgentEvent[] = [];
    await orchestrator.chat(sessionId, "我想吃麦香鸡套餐", (event) => quoteEvents.push(event));
    const quote = eventOf(quoteEvents, "confirmation_required");
    assert.ok(quote);
    assert.equal(provider.createOrderCalls, 0, "未点击确认前不能调用 createOrder");
    assert.doesNotMatch(JSON.stringify(quote?.data), /raw/);

    const statusBeforeConfirm: AgentEvent[] = [];
    await orchestrator.chat(sessionId, "查询订单状态", (event) => statusBeforeConfirm.push(event));
    assert.equal(provider.createOrderCalls, 0);
    assert.equal(eventOf(statusBeforeConfirm, "order"), undefined);

    const approvalId = String((quote.data as Record<string, unknown>).approvalId || "");
    assert.ok(approvalId);
    const storedApproval = await store.getApproval(approvalId);
    assert.doesNotMatch(JSON.stringify(storedApproval), /raw/);
    const quoteHash = String((quote.data as Record<string, unknown>).quoteHash || "");
    assert.ok(quoteHash);
    const order = await orchestrator.confirmOrder(sessionId, approvalId, quoteHash);
    assert.equal(provider.createOrderCalls, 1);
    assert.equal(order.orderStatus, "待支付（模拟）");
    assert.doesNotMatch(JSON.stringify(await store.getLatestOrder(sessionId)), /raw/);

    const statusAfterConfirm: AgentEvent[] = [];
    await orchestrator.chat(sessionId, "查询订单状态", (event) => statusAfterConfirm.push(event));
    assert.ok(eventOf(statusAfterConfirm, "order"));
    assert.equal(provider.createOrderCalls, 1, "查询状态不能重复创建订单");
  });
});

test("模型工具白名单不包含 create-order", () => {
  assert.equal(createModelTools().some((tool) => tool.function.name === "create-order"), false);
});
