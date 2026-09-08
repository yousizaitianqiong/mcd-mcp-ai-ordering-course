import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AppError } from "../errors.js";
import { McDonaldsMcpProvider, parseNutritionFoods } from "./mcd.js";

const remoteTools = [
  "delivery-query-addresses",
  "delivery-query-stores",
  "query-meals",
  "query-meal-detail",
  "query-store-coupons",
  "calculate-price",
  "query-order",
  "create-order",
];

test("营养工具只接受明确表头并按规范化餐品名读取每份千卡", () => {
  const foods = parseNutritionFoods(
    "[3]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n"
      + "  麦咖啡™美式,null,500,120,2,3,20,10,5\n"
      + "  重复餐品,null,500,100,2,3,20,10,5\n"
      + "  重复餐品,null,500,101,2,3,20,10,5",
  );
  assert.equal(foods.get("麦咖啡美式"), 120);
  assert.equal(foods.has("重复餐品"), false);
  assert.throws(
    () => parseNutritionFoods("[1]{productName,energyKcal}:\n  餐品,100"),
    (error: unknown) => error instanceof AppError && error.code === "MCP_SCHEMA_ERROR",
  );
});

test("MCD Provider 校验工具能力并按明确分单位转换领域结果", async () => {
  const called: string[] = [];
  let createArguments: Record<string, unknown> | undefined;
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    if (body.method === "initialize") {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Mcp-Session-Id", "mcd-test-session");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
      return;
    }
    if (body.method === "notifications/initialized") {
      response.statusCode = 202;
      response.end();
      return;
    }
    if (body.method === "tools/list") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: remoteTools.map((name) => ({ name, inputSchema: { type: "object", properties: {} } })) },
      }));
      return;
    }
    const params = (body.params || {}) as Record<string, unknown>;
    const name = String(params.name || "");
    called.push(name);
    if (name === "create-order") createArguments = (params.arguments || {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {
      "delivery-query-addresses": { addresses: [{ addressId: "a-1", contactName: "A", phone: "138****0000", fullAddress: "演示地址" }] },
      "delivery-query-stores": [{ storeCode: "s-1", beCode: "b-1", storeName: "演示门店", businessStatus: true }],
      "query-meals": { meals: { "meal-1": { name: "麦香鸡套餐", currentPrice: 2400 } } },
      "query-meal-detail": { code: "meal-1", name: "麦香鸡套餐" },
      "query-store-coupons": [{ couponId: "c-1", couponCode: "C1", title: "减 3 元" }],
      "calculate-price": { productPrice: 2400, deliveryPrice: 600, discount: 300, price: 2700 },
      "query-order": { orderId: "O-1", orderStatus: "待支付", realTotalAmount: 2700 },
      "create-order": { orderId: "O-1", orderDetail: { orderStatus: "待支付", realTotalAmount: 2700, storeName: "演示门店" } },
    };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: values[name] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    const provider = new McDonaldsMcpProvider(`http://127.0.0.1:${address.port}`, "token", "2025-06-18", "fen");
    assert.equal((await provider.checkConnection()).toolCount, 8);
    const addresses = await provider.listAddresses();
    const stores = await provider.listDeliverableStores({ addressId: "a-1", beType: 2 });
    const menu = await provider.listMeals({ storeCode: "s-1", beCode: "b-1", orderType: 2, beType: 2 });
    const coupons = await provider.listStoreCoupons({ storeCode: "s-1", beCode: "b-1", orderType: 2, beType: 2 });
    const context = { addressId: "a-1", address: addresses[0], storeCode: "s-1", beCode: "b-1", storeName: stores[0].storeName };
    const items = [{ productCode: "meal-1", productName: menu[0].name, quantity: 1, unitPrice: menu[0].price, storeCode: "s-1", beCode: "b-1" }];
    const quote = await provider.calculatePrice({ context, items });
    const order = await provider.createOrder({ context, items });
    assert.equal(menu[0].price, 24);
    assert.equal(quote.totalPrice, 27);
    assert.equal(coupons[0].couponCode, "C1");
    assert.equal(order.orderStatus, "待支付");
    assert.equal(createArguments?.orderType, 2);
    assert.deepEqual(called, ["delivery-query-addresses", "delivery-query-stores", "query-meals", "query-store-coupons", "calculate-price", "create-order"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("MCD Provider 缺少必要工具时 fail closed", async () => {
  const server = http.createServer((request, response) => {
    request.resume();
    response.setHeader("Content-Type", "application/json");
    if (request.url) {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    const provider = new McDonaldsMcpProvider(`http://127.0.0.1:${address.port}`, "token", "2025-06-18");
    await assert.rejects(() => provider.checkConnection(), (error: unknown) => error instanceof AppError && error.code === "MCP_REQUIRED_TOOL_MISSING");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("MCD Provider 使用可选营养工具为菜单和购物车提供每份热量", async () => {
  const called: string[] = [];
  const tools = [...remoteTools, "list-nutrition-foods"];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    response.setHeader("Content-Type", "application/json");
    if (body.method === "initialize") {
      response.setHeader("Mcp-Session-Id", "mcd-nutrition-session");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
      return;
    }
    if (body.method === "notifications/initialized") {
      response.statusCode = 202;
      response.end();
      return;
    }
    if (body.method === "tools/list") {
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: tools.map((name) => ({ name, inputSchema: { type: "object", properties: {} } })) },
      }));
      return;
    }
    const params = (body.params || {}) as Record<string, unknown>;
    const name = String(params.name || "");
    called.push(name);
    const values: Record<string, unknown> = {
      "query-meals": {
        meals: {
          "meal-1": { name: "双层吉士汉堡", currentPrice: 2400 },
          "meal-2": { name: "未知套餐", currentPrice: 1000 },
        },
      },
      "list-nutrition-foods": "[2]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n  双层吉士汉堡,null,1500,500,20,20,30,800,100\n  其他餐品,null,100,100,1,1,1,1,1",
    };
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: values[name] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    const provider = new McDonaldsMcpProvider(`http://127.0.0.1:${address.port}`, "token", "2025-06-18", "fen");
    const menu = await provider.listMeals({ storeCode: "s-1", beCode: "b-1", orderType: 2, beType: 2 });
    assert.equal(menu.find((item) => item.productCode === "meal-1")?.caloriesKcal, 500);
    assert.equal(menu.find((item) => item.productCode === "meal-2")?.caloriesKcal, undefined);
    assert.deepEqual(called, ["query-meals", "list-nutrition-foods"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
