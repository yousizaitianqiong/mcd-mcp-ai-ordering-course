import { createHash, timingSafeEqual } from "node:crypto";
import type { PriceQuote } from "./types.js";

interface QuoteSnapshot {
  provider: string;
  context: {
    addressId: string;
    storeCode: string;
    beCode: string;
    storeName: string;
  };
  items: Array<{
    productCode: string;
    quantity: number;
    unitPrice: number;
    storeCode: string;
    beCode: string;
  }>;
  productPrice: number;
  deliveryPrice: number;
  discount: number;
  totalPrice: number;
  currency: string;
  expiresAt: string;
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

function snapshot(provider: string, quote: PriceQuote): QuoteSnapshot {
  return {
    provider,
    context: {
      addressId: quote.context.addressId,
      storeCode: quote.context.storeCode,
      beCode: quote.context.beCode,
      storeName: quote.context.storeName,
    },
    items: quote.items.map((item) => ({
      productCode: item.productCode,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      storeCode: item.storeCode,
      beCode: item.beCode,
    })),
    productPrice: money(quote.productPrice),
    deliveryPrice: money(quote.deliveryPrice),
    discount: money(quote.discount),
    totalPrice: money(quote.totalPrice),
    currency: quote.currency,
    expiresAt: quote.expiresAt,
  };
}

export function calculateQuoteHash(provider: string, quote: PriceQuote): string {
  const canonical = JSON.stringify(snapshot(provider, quote));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function finalizeQuote(provider: string, quote: PriceQuote): PriceQuote {
  return { ...quote, quoteHash: calculateQuoteHash(provider, quote) };
}

export function sameQuoteHash(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
