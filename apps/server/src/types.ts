export type JsonObject = Record<string, unknown>;

export interface Address {
  addressId: string;
  contactName: string;
  phone: string;
  fullAddress: string;
}

export interface Store {
  storeCode: string;
  beCode: string;
  storeName: string;
  businessStatus: boolean;
  businessStartTime?: string;
  businessEndTime?: string;
  reservation?: boolean;
}

export interface MenuItem {
  productCode: string;
  name: string;
  price: number;
  tags: string[];
  /** 麦当劳营养工具返回的每份能量，单位为千卡；未匹配时省略。 */
  caloriesKcal?: number;
  category?: string;
  description?: string;
}

export interface Coupon {
  couponId: string;
  couponCode: string;
  title: string;
  validPeriod?: string;
  products?: Array<{ productCode: string; productName: string }>;
}

export interface CartItem {
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /** 每份能量，单位为千卡；未匹配时省略。 */
  caloriesKcal?: number;
  storeCode: string;
  beCode: string;
}

export interface OrderContext {
  addressId: string;
  address: Address;
  storeCode: string;
  beCode: string;
  storeName: string;
}

export interface PriceQuote {
  quoteId: string;
  context: OrderContext;
  items: CartItem[];
  productPrice: number;
  deliveryPrice: number;
  discount: number;
  totalPrice: number;
  currency: "CNY";
  expiresAt: string;
  quoteHash: string;
}

export interface CreateOrderInput {
  storeCode: string;
  beCode: string;
  addressId: string;
  orderType: 2;
  beType: 2;
  items: Array<{
    productCode: string;
    quantity: number;
    couponId?: string;
    couponCode?: string;
  }>;
}

export interface PendingOrder {
  orderId: string;
  payH5Url?: string;
  orderStatus: string;
  totalAmount: number;
  storeName?: string;
  deliveryAddress?: string;
}

export interface FoodOrderProvider {
  readonly name: string;
  listAddresses(): Promise<Address[]>;
  listDeliverableStores(input: { addressId: string; beType: 2 }): Promise<Store[]>;
  listMeals(input: {
    storeCode: string;
    beCode: string;
    orderType: 2;
    beType: 2;
  }): Promise<MenuItem[]>;
  getMealDetail(input: {
    storeCode: string;
    beCode: string;
    code: string;
    orderType: 2;
    beType: 2;
  }): Promise<JsonObject>;
  listStoreCoupons(input: {
    storeCode: string;
    beCode: string;
    orderType: 2;
    beType: 2;
  }): Promise<Coupon[]>;
  calculatePrice(input: {
    context: OrderContext;
    items: CartItem[];
  }): Promise<PriceQuote>;
  createOrder(input: {
    context: OrderContext;
    items: CartItem[];
  }): Promise<PendingOrder>;
  getOrderStatus(orderId: string): Promise<PendingOrder>;
}

export type MessageRole = "user" | "assistant" | "tool";

export interface StoredMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  createdAt: string;
}

export interface SessionState {
  id: string;
  messages: StoredMessage[];
  cart: CartItem[];
  context?: OrderContext;
  updatedAt: string;
}

export interface ApprovalRecord {
  approvalId: string;
  sessionId: string;
  quote: PriceQuote;
  status: "pending" | "submitting" | "confirmed" | "failed" | "unknown" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface StoredOrder {
  sessionId: string;
  order: PendingOrder;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  sessionId: string;
  eventType: string;
  toolName?: string;
  payload?: unknown;
  createdAt: string;
}

export interface AppState {
  sessions: Record<string, SessionState>;
  approvals: Record<string, ApprovalRecord>;
  orders: Record<string, StoredOrder>;
  audit: AuditEvent[];
}

export interface AgentEvent {
  type:
    | "session"
    | "assistant"
    | "tool"
    | "addresses"
    | "stores"
    | "menu"
    | "cart"
    | "quote"
    | "confirmation_required"
    | "order"
    | "error"
    | "done";
  data: unknown;
}
