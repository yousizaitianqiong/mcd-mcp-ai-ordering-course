import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import type {
  Address,
  CartItem,
  Coupon,
  FoodOrderProvider,
  JsonObject,
  MenuItem,
  OrderContext,
  PendingOrder,
  PriceQuote,
  Store,
} from "../types.js";

const address: Address = {
  addressId: "mock-address-1",
  contactName: "课程演示用户",
  phone: "138****0000",
  fullAddress: "成都市高新区课程演示路 1 号",
};

const store: Store = {
  storeCode: "mock-store-1",
  beCode: "mock-be-1",
  storeName: "高新课程演示餐厅",
  businessStatus: true,
  businessStartTime: "00:00",
  businessEndTime: "23:59",
};

const meals: MenuItem[] = [
  {
    productCode: "mock-mcchicken-combo",
    name: "麦香鸡套餐",
    price: 24,
    tags: ["经典", "套餐"],
    category: "套餐",
    description: "麦香鸡、薯条和中杯可乐。",
  },
  {
    productCode: "mock-double-cheese-combo",
    name: "双层吉士汉堡套餐",
    price: 31,
    tags: ["牛肉", "套餐"],
    category: "套餐",
    description: "双层吉士汉堡、薯条和中杯饮料。",
  },
  {
    productCode: "mock-spicy-wings",
    name: "香辣鸡翅",
    price: 13,
    tags: ["小食", "辣"],
    category: "小食",
    description: "外酥里嫩的香辣鸡翅。",
  },
  {
    productCode: "mock-fries",
    name: "中薯条",
    price: 12,
    tags: ["小食"],
    category: "小食",
    description: "经典金黄薯条。",
  },
];

const coupons: Coupon[] = [
  {
    couponId: "mock-coupon-1",
    couponCode: "COURSE10",
    title: "课程演示优惠券：满 20 减 3 元",
    validPeriod: "仅 Mock 模式展示",
    products: [{ productCode: "mock-mcchicken-combo", productName: "麦香鸡套餐" }],
  },
];

export class MockFoodOrderProvider implements FoodOrderProvider {
  readonly name = "mock";
  private readonly orders = new Map<string, PendingOrder>();

  async listAddresses(): Promise<Address[]> {
    return [address];
  }

  async listDeliverableStores(): Promise<Store[]> {
    return [store];
  }

  async listMeals(): Promise<MenuItem[]> {
    return meals;
  }

  async getMealDetail(input: { code: string }): Promise<JsonObject> {
    const meal = meals.find((item) => item.productCode === input.code);
    if (!meal) throw new AppError("MEAL_NOT_FOUND", "没有找到该模拟餐品", 404);
    return {
      code: meal.productCode,
      name: meal.name,
      price: meal.price,
      description: meal.description,
      rounds: [{ name: "默认规格", choices: [{ name: meal.name, quantity: 1 }] }],
    };
  }

  async listStoreCoupons(): Promise<Coupon[]> {
    return coupons;
  }

  async calculatePrice(input: { context: OrderContext; items: CartItem[] }): Promise<PriceQuote> {
    if (!input.items.length) throw new AppError("EMPTY_CART", "购物车还是空的", 400);
    const productPrice = input.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const discount = productPrice >= 20 ? 3 : 0;
    const deliveryPrice = 6;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    return {
      quoteId: `mock-quote-${randomUUID()}`,
      context: input.context,
      items: input.items,
      productPrice,
      deliveryPrice,
      discount,
      totalPrice: productPrice + deliveryPrice - discount,
      currency: "CNY",
      expiresAt,
      raw: { provider: "mock", coupons },
    };
  }

  async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
    const quote = await this.calculatePrice(input);
    const orderId = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    const order: PendingOrder = {
      orderId,
      payH5Url: `https://example.com/course-demo-pay/${orderId}`,
      orderStatus: "待支付（模拟）",
      totalAmount: quote.totalPrice,
      storeName: input.context.storeName,
      deliveryAddress: input.context.address.fullAddress,
      raw: { provider: "mock", createdAt: new Date().toISOString() },
    };
    this.orders.set(orderId, order);
    return order;
  }

  async getOrderStatus(orderId: string): Promise<PendingOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new AppError("ORDER_NOT_FOUND", "没有找到该模拟订单", 404);
    return order;
  }
}
