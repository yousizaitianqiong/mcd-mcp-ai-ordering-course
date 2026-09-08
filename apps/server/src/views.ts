import { AppError } from "./errors.js";
import type { CouponDisplay, MealDetail, PendingOrder, PriceQuote } from "./types.js";

const MAX_TEXT_LENGTH = 500;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 20 ? value : undefined;
}

function imageUrl(value: unknown): string | undefined {
  const candidate = text(value, 2_000);
  return candidate && (/^https?:\/\//i.test(candidate) || (candidate.startsWith("/") && !candidate.startsWith("//")))
    ? candidate
    : undefined;
}

/**
 * 从 Provider 结果中构造严格的套餐详情展示对象。
 * 必填字段异常时直接失败，任何未列入白名单的字段都会被丢弃。
 */
export function toMealDetailView(value: unknown): MealDetail {
  const source = record(value);
  const code = text(source?.code, 120);
  const name = text(source?.name, 200);
  if (!code || !name) {
    throw new AppError("INVALID_MEAL_DETAIL", "餐品详情格式不完整，已安全忽略远端结果", 502);
  }

  const view: MealDetail = { code, name };
  const description = text(source?.description);
  const image = imageUrl(source?.image);
  if (description) view.description = description;
  if (image) view.image = image;
  if (typeof source?.supportModify === "boolean") view.supportModify = source.supportModify;

  if (Array.isArray(source?.rounds)) {
    const rounds = source.rounds.flatMap((round): Array<NonNullable<MealDetail["rounds"]>[number]> => {
      const roundSource = record(round);
      if (!roundSource || !Array.isArray(roundSource.choices)) return [];
      const choices = roundSource.choices.flatMap((choice) => {
        const choiceSource = record(choice);
        const choiceName = text(choiceSource?.name, 200);
        if (!choiceName) return [];
        const safeChoice: { name: string; code?: string; quantity?: number } = { name: choiceName };
        const choiceCode = text(choiceSource?.code, 120);
        const quantity = positiveInteger(choiceSource?.quantity);
        if (choiceCode) safeChoice.code = choiceCode;
        if (quantity) safeChoice.quantity = quantity;
        return [safeChoice];
      });
      if (!choices.length) return [];
      const safeRound: NonNullable<MealDetail["rounds"]>[number] = { choices };
      const roundName = text(roundSource.name, 200);
      if (roundName) safeRound.name = roundName;
      return [safeRound];
    });
    if (rounds.length) view.rounds = rounds;
  }
  return view;
}

/**
 * 将优惠券数组转换为浏览器白名单对象；顶层或单项结构异常时只保留可验证项。
 */
export function toCouponViews(value: unknown): CouponDisplay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((coupon): CouponDisplay[] => {
    const source = record(coupon);
    const couponId = text(source?.couponId, 120);
    const couponCode = text(source?.couponCode, 120);
    const title = text(source?.title, 300);
    if (!couponId || !couponCode || !title) return [];

    const view: CouponDisplay = { couponId, couponCode, title };
    const validPeriod = text(source?.validPeriod, 300);
    if (validPeriod) view.validPeriod = validPeriod;
    if (Array.isArray(source?.products)) {
      const products = source.products.flatMap((product) => {
        const productSource = record(product);
        const productCode = text(productSource?.productCode, 120);
        const productName = text(productSource?.productName, 200);
        return productCode && productName ? [{ productCode, productName }] : [];
      });
      if (products.length) view.products = products;
    }
    return [view];
  });
}

/** 事件和 HTTP 响应只使用公开字段；PriceQuote 类型本身不包含 Provider raw。 */
export function toPriceQuoteView(quote: PriceQuote): PriceQuote {
  return { ...quote };
}

/** 事件和 HTTP 响应只使用公开字段；PendingOrder 类型本身不包含 Provider raw。 */
export function toPendingOrderView(order: PendingOrder): PendingOrder {
  return { ...order };
}
