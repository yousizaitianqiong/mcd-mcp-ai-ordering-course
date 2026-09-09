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

const MOCK_DELIVERY_PRICE = 6;
const MOCK_DISCOUNT = 3;
const MOCK_QUOTE_TTL_MS = 5 * 60_000;
const MOCK_ORDER_STATUS = "待支付（模拟）";

function isMockStore(input: { storeCode: string; beCode: string }): boolean {
  return input.storeCode === store.storeCode && input.beCode === store.beCode;
}

export class MockFoodOrderProvider implements FoodOrderProvider {
  readonly name = "mock";
  private readonly orders = new Map<string, PendingOrder>();

  async listAddresses(): Promise<Address[]> {
    return [structuredClone(address)];
  }

  async listDeliverableStores(input: { addressId: string; beType: 2 }): Promise<Store[]> {
    if (input.addressId !== address.addressId) return [];
    return [structuredClone(store)];
  }

  async listMeals(input: { storeCode: string; beCode: string; orderType: 2; beType: 2 }): Promise<MenuItem[]> {
    if (!isMockStore(input)) return [];
    return structuredClone(meals);
  }

  async getMealDetail(input: {
    storeCode: string;
    beCode: string;
    code: string;
    orderType: 2;
    beType: 2;
  }): Promise<JsonObject> {
    if (!isMockStore(input)) throw new AppError("STORE_NOT_FOUND", "没有找到该模拟门店", 404);
    const meal = meals.find((item) => item.productCode === input.code);
    if (!meal) throw new AppError("MEAL_NOT_FOUND", "没有找到该模拟餐品", 404);
    return structuredClone({
      code: meal.productCode,
      name: meal.name,
      price: meal.price,
      description: meal.description,
      rounds: [{ name: "默认规格", choices: [{ name: meal.name, quantity: 1 }] }],
    });
  }

  async listStoreCoupons(input: { storeCode: string; beCode: string; orderType: 2; beType: 2 }): Promise<Coupon[]> {
    if (!isMockStore(input)) return [];
    return structuredClone(coupons);
  }

  async calculatePrice(input: { context: OrderContext; items: CartItem[] }): Promise<PriceQuote> {
    if (input.context.addressId !== address.addressId || !isMockStore(input.context)) {
      throw new AppError("CONTEXT_REQUIRED", "模拟报价需要使用有效的演示地址和门店");
    }
    if (!input.items.length) throw new AppError("EMPTY_CART", "购物车还是空的", 400);
    for (const item of input.items) {
      const catalogItem = meals.find((meal) => meal.productCode === item.productCode);
      if (!catalogItem) throw new AppError("ITEM_NOT_IN_MENU", "只能核价当前模拟菜单中的餐品", 400);
      if (item.storeCode !== store.storeCode || item.beCode !== store.beCode) {
        throw new AppError("STORE_NOT_FOUND", "餐品不属于当前模拟门店", 404);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
        throw new AppError("INVALID_QUANTITY", "餐品数量必须是 1 到 20 的整数", 400);
      }
    }
    const productPrice = input.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const discount = productPrice >= 20 ? MOCK_DISCOUNT : 0;
    const deliveryPrice = MOCK_DELIVERY_PRICE;
    const expiresAt = new Date(Date.now() + MOCK_QUOTE_TTL_MS).toISOString();
    return {
      quoteId: `mock-quote-${randomUUID()}`,
      context: structuredClone(input.context),
      items: structuredClone(input.items),
      productPrice,
      deliveryPrice,
      discount,
      totalPrice: productPrice + deliveryPrice - discount,
      currency: "CNY",
      expiresAt,
      quoteHash: "",
    };
  }

  async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
    const quote = await this.calculatePrice(input);
    const orderId = `MOCK-ORDER-${randomUUID().slice(0, 8).toUpperCase()}`;
    const order: PendingOrder = {
      orderId,
      // .invalid 是保留域名，明确表示课堂 Mock 链路不会打开真实支付页面。
      payH5Url: `https://example.invalid/course-demo-pay/${orderId}`,
      orderStatus: MOCK_ORDER_STATUS,
      totalAmount: quote.totalPrice,
      storeName: input.context.storeName,
      deliveryAddress: input.context.address.fullAddress,
    };
    this.orders.set(orderId, structuredClone(order));
    return structuredClone(order);
  }

  async getOrderStatus(orderId: string): Promise<PendingOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new AppError("ORDER_NOT_FOUND", "没有找到该模拟订单", 404);
    return structuredClone(order);
  }
}
