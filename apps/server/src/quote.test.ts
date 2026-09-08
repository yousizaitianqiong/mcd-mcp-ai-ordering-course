import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuoteHash, finalizeQuote, sameQuoteHash } from "./quote.js";
import type { PriceQuote } from "./types.js";

function quote(): PriceQuote {
  return {
    quoteId: "q-1",
    context: {
      addressId: "a-1",
      address: { addressId: "a-1", contactName: "测试", phone: "138****0000", fullAddress: "测试地址" },
      storeCode: "s-1",
      beCode: "b-1",
      storeName: "测试门店",
    },
    items: [{ productCode: "meal-1", productName: "套餐", quantity: 1, unitPrice: 24, storeCode: "s-1", beCode: "b-1" }],
    productPrice: 24,
    deliveryPrice: 6,
    discount: 3,
    totalPrice: 27,
    currency: "CNY",
    expiresAt: "2099-01-01T00:00:00.000Z",
    quoteHash: "",
  };
}

test("报价哈希不包含完整地址且会随金额变化", () => {
  const first = finalizeQuote("mock", quote());
  const changedAddress = finalizeQuote("mock", {
    ...quote(),
    context: { ...quote().context, address: { ...quote().context.address, fullAddress: "另一条真实地址" } },
  });
  const changedPrice = finalizeQuote("mock", { ...quote(), totalPrice: 28 });

  assert.equal(first.quoteHash, changedAddress.quoteHash);
  assert.notEqual(first.quoteHash, changedPrice.quoteHash);
  assert.equal(first.quoteHash, calculateQuoteHash("mock", first));
  assert.equal(sameQuoteHash(first.quoteHash, first.quoteHash), true);
  assert.equal(sameQuoteHash(first.quoteHash, "bad"), false);
});
