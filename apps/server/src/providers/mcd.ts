import { AppError } from "../errors.js";
import { McpHttpClient, unwrapMcpData, type RemoteToolDefinition } from "../mcp/client.js";
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

const requiredRemoteTools = [
  "delivery-query-addresses",
  "delivery-query-stores",
  "query-meals",
  "query-meal-detail",
  "query-store-coupons",
  "calculate-price",
  "query-order",
  "create-order",
] as const;

const nutritionToolName = "list-nutrition-foods";
const nutritionColumns = [
  "productName",
  "nutritionDescription",
  "energyKj",
  "energyKcal",
  "protein",
  "fat",
  "carbohydrate",
  "sodium",
  "calcium",
] as const;

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("MCP_SCHEMA_ERROR", `麦当劳 MCP 返回的${label}格式无效`, 502);
  }
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new AppError("MCP_SCHEMA_ERROR", `麦当劳 MCP 返回的${label}格式无效`, 502);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("MCP_SCHEMA_ERROR", `麦当劳 MCP 返回的${label}缺失`, 502);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown, label: string): number {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError("MCP_SCHEMA_ERROR", `麦当劳 MCP 返回的${label}金额无效`, 502);
  }
  return parsed;
}

function money(value: unknown, unit: "yuan" | "fen", label: string): number {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const amount = record.amount ?? record.value;
    const declaredUnit = String(record.unit || "").toLowerCase();
    if (declaredUnit === "fen" || declaredUnit === "cent" || declaredUnit === "cents") {
      return Number((numberValue(amount, label) / 100).toFixed(2));
    }
    if (declaredUnit === "yuan" || declaredUnit === "cny" || declaredUnit === "rmb") {
      return Number(numberValue(amount, label).toFixed(2));
    }
    throw new AppError("MCP_SCHEMA_ERROR", `麦当劳 MCP 返回的${label}缺少明确金额单位`, 502);
  }
  const parsed = numberValue(value, label);
  return Number((unit === "fen" ? parsed / 100 : parsed).toFixed(2));
}

function firstValue(record: JsonObject, keys: string[], label: string): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  throw new AppError("MCP_SCHEMA_ERROR", `麦当劳 MCP 返回的${label}缺失`, 502);
}

function normalizeFoodName(value: string): string {
  return value.replace(/[™®]/g, "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      fields.push(field.trim());
      field = "";
      continue;
    }
    field += character;
  }
  if (quoted) throw new AppError("MCP_SCHEMA_ERROR", "麦当劳营养工具返回了未闭合字段", 502);
  fields.push(field.trim());
  return fields;
}

/**
 * 解析 list-nutrition-foods 的文本表格，只接受已知列和明确的 energyKcal。
 * 营养数据是可选展示信息，调用方会在解析失败时放弃填充而不会猜测数值。
 */
export function parseNutritionFoods(value: unknown): Map<string, number> {
  const text = typeof value === "string"
    ? value
    : value && typeof value === "object" && !Array.isArray(value) && typeof (value as JsonObject).rawText === "string"
      ? String((value as JsonObject).rawText)
      : undefined;
  if (text === undefined) {
    throw new AppError("MCP_SCHEMA_ERROR", "麦当劳营养工具返回格式无效", 502);
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines.shift();
  const match = header?.match(/^\[\d+\]\{(.+)\}:$/);
  if (!match) throw new AppError("MCP_SCHEMA_ERROR", "麦当劳营养工具缺少有效表头", 502);
  const columns = splitCsvLine(match[1]);
  if (columns.length !== nutritionColumns.length || columns.some((column, index) => column !== nutritionColumns[index])) {
    throw new AppError("MCP_SCHEMA_ERROR", "麦当劳营养工具字段不兼容", 502);
  }

  const result = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const line of lines) {
    const fields = splitCsvLine(line);
    if (fields.length !== nutritionColumns.length) {
      throw new AppError("MCP_SCHEMA_ERROR", "麦当劳营养工具数据列数无效", 502);
    }
    const productName = fields[0];
    const calories = Number(fields[3]);
    if (!productName || !Number.isFinite(calories) || calories < 0) {
      throw new AppError("MCP_SCHEMA_ERROR", "麦当劳营养工具热量字段无效", 502);
    }
    const key = normalizeFoodName(productName);
    if (!key || ambiguous.has(key)) continue;
    const previous = result.get(key);
    if (previous !== undefined && previous !== calories) {
      result.delete(key);
      ambiguous.add(key);
      continue;
    }
    result.set(key, calories);
  }
  return result;
}

function deliveryAddress(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return optionalString(record.deliveryAddress) || optionalString(record.address) || optionalString(record.fullAddress);
  }
  return undefined;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false" || value === undefined || value === null) return false;
  throw new AppError("MCP_SCHEMA_ERROR", "麦当劳 MCP 返回的布尔字段格式无效", 502);
}

function validateArguments(tool: RemoteToolDefinition, args: Record<string, unknown>): void {
  const schema = tool.inputSchema;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = schema.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, unknown>
    : {};
  for (const key of required) {
    if (typeof key !== "string" || args[key] === undefined || args[key] === null || args[key] === "") {
      throw new AppError("MCP_INPUT_SCHEMA_ERROR", `远端工具 ${tool.name} 缺少参数 ${String(key)}`, 502);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!property || typeof property !== "object") continue;
    const expected = (property as Record<string, unknown>).type;
    if (expected === "string" && typeof value !== "string") {
      throw new AppError("MCP_INPUT_SCHEMA_ERROR", `远端工具 ${tool.name} 的参数 ${key} 类型无效`, 502);
    }
    if (expected === "integer" && (!Number.isInteger(value) || typeof value !== "number")) {
      throw new AppError("MCP_INPUT_SCHEMA_ERROR", `远端工具 ${tool.name} 的参数 ${key} 类型无效`, 502);
    }
    if (expected === "array" && !Array.isArray(value)) {
      throw new AppError("MCP_INPUT_SCHEMA_ERROR", `远端工具 ${tool.name} 的参数 ${key} 类型无效`, 502);
    }
  }
}

export class McDonaldsMcpProvider implements FoodOrderProvider {
  readonly name = "mcd";
  private readonly client: McpHttpClient;
  private verifiedTools?: Map<string, RemoteToolDefinition>;
  private nutritionIndex?: Promise<Map<string, number>>;

  constructor(
    url: string,
    token: string,
    protocolVersion: string,
    private readonly moneyUnit: "yuan" | "fen" = "yuan",
  ) {
    this.client = new McpHttpClient(url, token, protocolVersion);
  }

  async checkConnection(): Promise<{ toolCount: number }> {
    const tools = await this.ensureTools();
    return { toolCount: tools.size };
  }

  private async ensureTools(): Promise<Map<string, RemoteToolDefinition>> {
    if (this.verifiedTools) return this.verifiedTools;
    const definitions = await this.client.listTools();
    const tools = new Map(definitions.map((tool) => [tool.name, tool]));
    const missing = requiredRemoteTools.filter((name) => !tools.has(name));
    if (missing.length) {
      throw new AppError("MCP_REQUIRED_TOOL_MISSING", `麦当劳 MCP 缺少必要工具：${missing.join(", ")}`, 502);
    }
    this.verifiedTools = tools;
    return tools;
  }

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tools = await this.ensureTools();
    const definition = tools.get(name);
    if (!definition) throw new AppError("MCP_TOOL_NOT_ALLOWED", `远端工具 ${name} 未通过能力检查`, 502);
    validateArguments(definition, args);
    return unwrapMcpData(await this.client.callTool(name, args));
  }

  private async getNutritionIndex(tools: Map<string, RemoteToolDefinition>): Promise<Map<string, number>> {
    if (!this.nutritionIndex) {
      this.nutritionIndex = (async () => {
        const definition = tools.get(nutritionToolName);
        if (!definition) return new Map<string, number>();
        try {
          validateArguments(definition, {});
          return parseNutritionFoods(await this.call(nutritionToolName, {}));
        } catch {
          // 营养信息不是核价或下单前提；远端未提供或格式变化时安全地不展示。
          return new Map<string, number>();
        }
      })();
    }
    return this.nutritionIndex;
  }

  async listAddresses(): Promise<Address[]> {
    const data = asObject(await this.call("delivery-query-addresses", {}), "地址结果");
    const addresses = asArray(data.addresses, "地址列表");
    return addresses.map((item) => {
      const value = asObject(item, "地址项");
      return {
        addressId: requiredString(value.addressId, "地址 ID"),
        contactName: optionalString(value.contactName) || "已脱敏用户",
        phone: optionalString(value.phone) || "已脱敏手机号",
        fullAddress: requiredString(value.fullAddress || value.address, "配送地址"),
      };
    });
  }

  async listDeliverableStores(input: { addressId: string; beType: 2 }): Promise<Store[]> {
    const data = await this.call("delivery-query-stores", {
      addressId: input.addressId,
      beType: input.beType,
    });
    return asArray(data, "门店列表").map((item) => {
      const value = asObject(item, "门店项");
      return {
        storeCode: requiredString(value.storeCode, "门店编码"),
        beCode: requiredString(value.beCode, "业务编码"),
        storeName: requiredString(value.storeName, "门店名称"),
        businessStatus: booleanValue(value.businessStatus),
        businessStartTime: optionalString(value.businessStartTime),
        businessEndTime: optionalString(value.businessEndTime),
        reservation: value.reservation === undefined ? undefined : booleanValue(value.reservation),
      };
    });
  }

  async listMeals(input: {
    storeCode: string;
    beCode: string;
    orderType: 2;
    beType: 2;
  }): Promise<MenuItem[]> {
    const tools = await this.ensureTools();
    const data = asObject(await this.call("query-meals", input), "菜单结果");
    const meals = data.meals;
    if (!meals || typeof meals !== "object" || Array.isArray(meals)) {
      throw new AppError("MCP_SCHEMA_ERROR", "麦当劳 MCP 返回的 meals 格式无效", 502);
    }
    const tagsByCode = new Map<string, string[]>();
    if (Array.isArray(data.categories)) {
      for (const category of data.categories) {
        const value = asObject(category, "菜单分类");
        const categoryName = optionalString(value.name) || "";
        const categoryMeals = Array.isArray(value.meals) ? value.meals : [];
        for (const meal of categoryMeals) {
          const item = asObject(meal, "分类餐品");
          const code = optionalString(item.code);
          if (code) tagsByCode.set(code, [categoryName, ...(Array.isArray(item.tags) ? item.tags.map(String) : [])].filter(Boolean));
        }
      }
    }
    const nutritionIndex = await this.getNutritionIndex(tools);
    return Object.entries(meals as Record<string, unknown>).map(([code, item]) => {
      const value = asObject(item, "菜单餐品");
      const name = requiredString(value.name, `餐品 ${code} 名称`);
      const caloriesKcal = nutritionIndex.get(normalizeFoodName(name));
      return {
        productCode: code,
        name,
        price: money(firstValue(value, ["currentPrice", "price"], `餐品 ${code}价格`), this.moneyUnit, `餐品 ${code}`),
        ...(caloriesKcal === undefined ? {} : { caloriesKcal }),
        tags: tagsByCode.get(code) || [],
        category: optionalString(value.category),
        description: optionalString(value.description),
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
    return asObject(await this.call("query-meal-detail", input), "餐品详情");
  }

  async listStoreCoupons(input: {
    storeCode: string;
    beCode: string;
    orderType: 2;
    beType: 2;
  }): Promise<Coupon[]> {
    const data = await this.call("query-store-coupons", input);
    const list = Array.isArray(data) ? data : asArray(asObject(data, "优惠券结果").coupons, "优惠券列表");
    return list.map((item) => {
      const value = asObject(item, "优惠券项");
      return {
        couponId: requiredString(value.couponId, "优惠券 ID"),
        couponCode: requiredString(value.couponCode, "优惠券编码"),
        title: requiredString(value.title, "优惠券标题"),
        validPeriod: optionalString(value.tradeDateTime) || optionalString(value.validPeriod),
        products: Array.isArray(value.products)
          ? value.products.map((product) => {
              const p = asObject(product, "优惠券商品");
              return {
                productCode: requiredString(p.productCode, "优惠券商品编码"),
                productName: requiredString(p.productName, "优惠券商品名称"),
              };
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
      "核价结果",
    );
    const remoteExpiry = optionalString(data.expiresAt);
    const expiresAt = remoteExpiry && Date.parse(remoteExpiry) > Date.now()
      ? remoteExpiry
      : new Date(Date.now() + 5 * 60_000).toISOString();
    return {
      quoteId: requiredString(data.quoteId || `mcd-quote-${Date.now().toString(36)}`, "报价 ID"),
      context: input.context,
      items: input.items,
      productPrice: money(firstValue(data, ["productPrice"], "商品金额"), this.moneyUnit, "商品金额"),
      deliveryPrice: money(firstValue(data, ["deliveryPrice"], "配送费"), this.moneyUnit, "配送费"),
      discount: money(firstValue(data, ["discount"], "优惠金额"), this.moneyUnit, "优惠金额"),
      totalPrice: money(firstValue(data, ["price", "realPrice", "totalPrice"], "应付总价"), this.moneyUnit, "应付总价"),
      currency: "CNY",
      expiresAt,
      quoteHash: "",
    };
  }

  async createOrder(input: { context: OrderContext; items: CartItem[] }): Promise<PendingOrder> {
    const data = asObject(
      await this.call("create-order", {
        storeCode: input.context.storeCode,
        beCode: input.context.beCode,
        addressId: input.context.addressId,
        orderType: 2,
        beType: 2,
        items: input.items.map((item) => ({ productCode: item.productCode, quantity: item.quantity })),
      }),
      "创建订单结果",
    );
    const detail = data.orderDetail && typeof data.orderDetail === "object"
      ? asObject(data.orderDetail, "订单详情")
      : data;
    const orderId = requiredString(data.orderId || detail.orderId, "订单号");
    const orderStatus = requiredString(detail.orderStatus || data.orderStatus, "订单状态");
    const totalValue = firstValue(detail, ["realTotalAmount", "totalAmount"], "订单金额");
    return {
      orderId,
      payH5Url: optionalString(data.payH5Url),
      orderStatus,
      totalAmount: money(totalValue, this.moneyUnit, "订单金额"),
      storeName: optionalString(detail.storeName) || input.context.storeName,
      deliveryAddress: deliveryAddress(detail.deliveryInfo) || input.context.address.fullAddress,
    };
  }

  async getOrderStatus(orderId: string): Promise<PendingOrder> {
    const data = asObject(await this.call("query-order", { orderId }), "订单查询结果");
    const detail = data.orderDetail && typeof data.orderDetail === "object"
      ? asObject(data.orderDetail, "订单详情")
      : data;
    const returnedOrderId = requiredString(data.orderId || detail.orderId || orderId, "订单号");
    const status = requiredString(detail.orderStatus || data.orderStatus, "订单状态");
    const amount = firstValue(detail, ["realTotalAmount", "totalAmount"], "订单金额");
    return {
      orderId: returnedOrderId,
      payH5Url: optionalString(data.payH5Url),
      orderStatus: status,
      totalAmount: money(amount, this.moneyUnit, "订单金额"),
      storeName: optionalString(detail.storeName),
      deliveryAddress: deliveryAddress(detail.deliveryInfo),
    };
  }
}
