import { AppError } from "../errors.js";
import { McpHttpClient, unwrapMcpData } from "../mcp/client.js";
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

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: unknown): number {
  const parsed = numberValue(value);
  // 官方示例同时出现“22”和“2200”，对明显的分单位金额做兼容处理。
  return parsed >= 1000 ? parsed / 100 : parsed;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

export class McDonaldsMcpProvider implements FoodOrderProvider {
  readonly name = "mcd";
  private readonly client: McpHttpClient;

  constructor(url: string, token: string, protocolVersion: string) {
    this.client = new McpHttpClient(url, token, protocolVersion);
  }

  async checkConnection(): Promise<{ toolCount: number }> {
    const tools = await this.client.listTools();
    return { toolCount: tools.length };
  }

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return unwrapMcpData(await this.client.callTool(name, args));
  }

  async listAddresses(): Promise<Address[]> {
    const data = asObject(await this.call("delivery-query-addresses", {}));
    const addresses = Array.isArray(data.addresses) ? data.addresses : [];
    return addresses.map((item) => {
      const value = asObject(item);
      return {
        addressId: String(value.addressId || ""),
        contactName: String(value.contactName || ""),
        phone: String(value.phone || ""),
        fullAddress: String(value.fullAddress || ""),
      };
    });
  }

  async listDeliverableStores(input: { addressId: string; beType: 2 }): Promise<Store[]> {
    const data = await this.call("delivery-query-stores", {
      addressId: input.addressId,
      beType: input.beType,
    });
    if (!Array.isArray(data)) return [];
    return data.map((item) => {
      const value = asObject(item);
      return {
        storeCode: String(value.storeCode || ""),
        beCode: String(value.beCode || ""),
        storeName: String(value.storeName || ""),
        businessStatus: Boolean(value.businessStatus),
        businessStartTime: value.businessStartTime ? String(value.businessStartTime) : undefined,
        businessEndTime: value.businessEndTime ? String(value.businessEndTime) : undefined,
        reservation: Boolean(value.reservation),
      };
    });
  }

  async listMeals(input: {
    storeCode: string;
    beCode: string;
    orderType: 2;
    beType: 2;
  }): Promise<MenuItem[]> {
    const data = asObject(await this.call("query-meals", input));
    const meals = asObject(data.meals);
    const tagsByCode = new Map<string, string[]>();
    if (Array.isArray(data.categories)) {
      for (const category of data.categories) {
        const value = asObject(category);
        const categoryName = String(value.name || "");
        const categoryMeals = Array.isArray(value.meals) ? value.meals : [];
        for (const meal of categoryMeals) {
          const item = asObject(meal);
          const code = String(item.code || "");
          if (code) tagsByCode.set(code, [categoryName, ...(Array.isArray(item.tags) ? item.tags.map(String) : [])]);
        }
      }
    }
    return Object.entries(meals).map(([code, item]) => {
      const value = asObject(item);
      return {
        productCode: code,
        name: String(value.name || code),
        price: money(value.currentPrice),
        tags: tagsByCode.get(code) || [],
      };
    });
  }

  async getMealDetail(input: {
    storeCode: string;
    beCode: string;
    code: string;
    orderType: 2;
    beType: 2;
  }): Promise<JsonObject> {
    return asObject(await this.call("query-meal-detail", input));
  }

  async listStoreCoupons(input: {
    storeCode: string;
    beCode: string;
    orderType: 2;
    beType: 2;
  }): Promise<Coupon[]> {
    const data = await this.call("query-store-coupons", input);
    if (!Array.isArray(data)) return [];
    return data.map((item) => {
      const value = asObject(item);
      return {
        couponId: String(value.couponId || ""),
        couponCode: String(value.couponCode || ""),
        title: String(value.title || "未命名优惠券"),
        validPeriod: value.tradeDateTime ? String(value.tradeDateTime) : undefined,
        products: Array.isArray(value.products)
          ? value.products.map((product) => {
              const p = asObject(product);
              return { productCode: String(p.productCode || ""), productName: String(p.productName || "") };
            })
          : undefined,
      };
    });
  }

  async calculatePrice(input: { context: OrderContext; items: CartItem[] }): Promise<PriceQuote> {
    const data = asObject(
      await this.call("calculate-price", {
        storeCode: input.context.storeCode,
        beCode: input.context.beCode,
        orderType: 2,
        beType: 2,
        items: input.items.map((item) => ({ productCode: item.productCode, quantity: item.quantity })),
      }),
    );
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    return {
      quoteId: `mcd-quote-${Date.now().toString(36)}`,
      context: input.context,
      items: input.items,
      productPrice: money(data.productPrice),
      deliveryPrice: money(data.deliveryPrice),
      discount: money(data.discount),
      totalPrice: money(data.price ?? data.realPrice ?? data.totalPrice),
      currency: "CNY",
      expiresAt,
      raw: data,
    };
  }

  async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
    const data = asObject(
      await this.call("create-order", {
        storeCode: input.context.storeCode,
        beCode: input.context.beCode,
        addressId: input.context.addressId,
        beType: 2,
        items: input.items.map((item) => ({ productCode: item.productCode, quantity: item.quantity })),
      }),
    );
    const detail = asObject(data.orderDetail);
    const orderId = String(data.orderId || detail.orderId || "");
    if (!orderId) throw new AppError("MCD_ORDER_ID_MISSING", "麦当劳 MCP 未返回订单号", 502, data);
    return {
      orderId,
      payH5Url: data.payH5Url ? String(data.payH5Url) : undefined,
      orderStatus: String(detail.orderStatus || "待支付"),
      totalAmount: money(detail.realTotalAmount ?? detail.totalAmount),
      storeName: detail.storeName ? String(detail.storeName) : input.context.storeName,
      deliveryAddress: detail.deliveryInfo ? String(asObject(detail.deliveryInfo).deliveryAddress || "") : input.context.address.fullAddress,
      raw: data,
    };
  }

  async getOrderStatus(orderId: string): Promise<PendingOrder> {
    const data = asObject(await this.call("query-order", { orderId }));
    const detail = asObject(data.orderDetail || data);
    return {
      orderId: String(data.orderId || detail.orderId || orderId),
      payH5Url: data.payH5Url ? String(data.payH5Url) : undefined,
      orderStatus: String(detail.orderStatus || "未知状态"),
      totalAmount: money(detail.realTotalAmount ?? detail.totalAmount),
      storeName: detail.storeName ? String(detail.storeName) : undefined,
      deliveryAddress: detail.deliveryInfo ? String(asObject(detail.deliveryInfo).deliveryAddress || "") : undefined,
      raw: data,
    };
  }
}
