import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "../errors.js";
import { OrderingOrchestrator } from "../orchestrator.js";
import { JsonStore } from "../store.js";
import type { AgentEvent, Address, Store } from "../types.js";
import { MockFoodOrderProvider } from "./mock.js";

const validStoreInput = { storeCode: "mock-store-1", beCode: "mock-be-1", orderType: 2 as const, beType: 2 as const };

test("Mock 提供完整菜单、报价、模拟订单和可查询状态", async () => {
  const provider = new MockFoodOrderProvider();
  const addresses = await provider.listAddresses();
  const stores = await provider.listDeliverableStores({ addressId: addresses[0].addressId, beType: 2 });
  const menu = await provider.listMeals(validStoreInput);
  const coupons = await provider.listStoreCoupons(validStoreInput);
  const context = {
    addressId: addresses[0].addressId,
    address: addresses[0],
    storeCode: stores[0].storeCode,
    beCode: stores[0].beCode,
    storeName: stores[0].storeName,
  };
  const items = [{
    productCode: menu[0].productCode,
    productName: menu[0].name,
    quantity: 1,
    unitPrice: menu[0].price,
    storeCode: context.storeCode,
    beCode: context.beCode,
  }];

  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].fullAddress.includes("课程演示"), true);
  assert.equal(stores.length, 1);
  assert.equal(stores[0].businessStatus, true);
  assert.equal(menu.length, 4);
  assert.deepEqual(menu.map((item) => item.name), ["麦香鸡套餐", "双层吉士汉堡套餐", "香辣鸡翅", "中薯条"]);
  assert.equal(coupons[0].couponCode, "COURSE10");

  const quote = await provider.calculatePrice({ context, items });
  assert.equal(quote.productPrice, 24);
  assert.equal(quote.deliveryPrice, 6);
  assert.equal(quote.discount, 3);
  assert.equal(quote.totalPrice, 27);
  assert.equal(quote.currency, "CNY");
  assert.equal(quote.quoteHash, "");
  assert.equal(Date.parse(quote.expiresAt) > Date.now(), true);

  const order = await provider.createOrder({ context, items });
  assert.match(order.orderId, /^MOCK-ORDER-[0-9A-F-]+$/);
  assert.equal(order.orderStatus, "待支付（模拟）");
  assert.equal(order.totalAmount, 27);
  assert.match(order.payH5Url || "", /^https:\/\/example\.invalid\//);
  assert.deepEqual(await provider.getOrderStatus(order.orderId), order);
  await assert.rejects(
    () => provider.getOrderStatus("MOCK-ORDER-NOT-FOUND"),
    (error: unknown) => error instanceof AppError && error.code === "ORDER_NOT_FOUND",
  );
});

test("Mock 对未知地址、门店和失效餐品 fail closed", async () => {
  const provider = new MockFoodOrderProvider();
  assert.deepEqual(await provider.listDeliverableStores({ addressId: "mock-address-disabled", beType: 2 }), []);
  assert.deepEqual(await provider.listMeals({ ...validStoreInput, storeCode: "mock-store-disabled" }), []);
  assert.deepEqual(await provider.listStoreCoupons({ ...validStoreInput, beCode: "mock-be-disabled" }), []);
  await assert.rejects(
    () => provider.getMealDetail({ ...validStoreInput, code: "mock-meal-disabled" }),
    (error: unknown) => error instanceof AppError && error.code === "MEAL_NOT_FOUND",
  );
});

class EmptyAddressProvider extends MockFoodOrderProvider {
  override async listAddresses(): Promise<Address[]> {
    return [];
  }
}

class EmptyStoreProvider extends MockFoodOrderProvider {
  override async listDeliverableStores(_input: { addressId: string; beType: 2 }): Promise<Store[]> {
    return [];
  }
}

async function assertMockChatError(provider: MockFoodOrderProvider, expectedCode: string): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-mock-error-"));
  try {
    const store = new JsonStore(path.join(directory, "state.json"));
    await store.load();
    const orchestrator = new OrderingOrchestrator(provider, store);
    const events: AgentEvent[] = [];
    await orchestrator.chat(undefined, "查询菜单", (event) => events.push(event));
    const error = events.find((event) => event.type === "error")?.data as { code?: string; message?: string } | undefined;
    assert.equal(error?.code, expectedCode);
    assert.equal(typeof error?.message, "string");
    assert.equal(events.at(-1)?.type, "done");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("Mock 空地址和无门店场景返回稳定中文错误且正常结束 SSE 语义", async () => {
  await assertMockChatError(new EmptyAddressProvider(), "ADDRESS_NOT_FOUND");
  await assertMockChatError(new EmptyStoreProvider(), "STORE_NOT_FOUND");
});
