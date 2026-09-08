import { randomUUID } from "node:crypto";
import { AppError, toErrorPayload } from "./errors.js";
import type { LlmMessage, LlmTool, ModelAdapter } from "./model.js";
import { calculateQuoteHash, finalizeQuote, sameQuoteHash } from "./quote.js";
import type { JsonStore } from "./store.js";
import type {
  AgentEvent,
  Address,
  CartItem,
  FoodOrderProvider,
  MenuItem,
  OrderContext,
  PendingOrder,
  PriceQuote,
  SessionState,
  Store,
} from "./types.js";
import { toCouponViews, toMealDetailView, toPendingOrderView, toPriceQuoteView } from "./views.js";

const systemPrompt = `你是“AI 麦乐送助手”课程项目中的点餐助手。
你只能基于工具返回的真实菜单、价格和订单状态回答，不得猜测商品编码、门店编码、地址或价格。
先查询地址和可配送门店，再查询菜单；用户需要下单时必须先核价。
创建订单不是模型工具，必须由用户在页面中明确点击确认按钮完成。
回答使用简洁中文，重要金额使用人民币元。`;

const tools: LlmTool[] = [
  {
    type: "function",
    function: {
      name: "list_delivery_addresses",
      description: "查询用户已有的麦乐送配送地址。",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_deliverable_stores",
      description: "根据配送地址查询可配送的麦当劳门店。必须使用地址工具返回的 addressId。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { addressId: { type: "string" } },
        required: ["addressId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_menu",
      description: "查询指定可配送门店的当前菜单。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { storeCode: { type: "string" }, beCode: { type: "string" } },
        required: ["storeCode", "beCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_meal_detail",
      description: "查询套餐组成和规格详情。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { storeCode: { type: "string" }, beCode: { type: "string" }, code: { type: "string" } },
        required: ["storeCode", "beCode", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_store_coupons",
      description: "查询当前门店和麦乐送场景下可用的优惠券。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { storeCode: { type: "string" }, beCode: { type: "string" } },
        required: ["storeCode", "beCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "把已经从菜单工具得到的餐品加入购物车。",
      parameters: {
        type: "object",
        additionalProperties: false,
          properties: {
            productCode: { type: "string" },
            quantity: { type: "integer", minimum: 1, maximum: 20 },
          },
        required: ["productCode", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "view_cart",
      description: "查看当前购物车，核价前必须调用。",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_price",
      description: "核算当前购物车的商品金额、配送费、优惠和应付总价。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { productCode: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
              required: ["productCode", "quantity"],
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_status",
      description: "查询已经创建的订单状态。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { orderId: { type: "string" } },
        required: ["orderId"],
      },
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function int(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

export class OrderingOrchestrator {
  constructor(
    private readonly provider: FoodOrderProvider,
    private readonly store: JsonStore,
    private readonly model?: ModelAdapter,
    private readonly modelMaxTurns = 8,
  ) {}

  async chat(
    requestedSessionId: string | undefined,
    message: string,
    emit: (event: AgentEvent) => void,
  ): Promise<string> {
    const session = await this.store.ensureSession(requestedSessionId);
    emit({ type: "session", data: { sessionId: session.id, provider: this.provider.name } });
    await this.store.appendMessage(session.id, "user", message);
    await this.store.addAudit(session.id, "chat_message", { length: message.length });
    try {
      if (this.model) {
        return await this.runModel(session.id, message, emit);
      }
      return await this.runMockAgent(session.id, message, emit);
    } catch (error) {
      const payload = toErrorPayload(error);
      emit({ type: "error", data: payload });
      const text = `本次操作没有完成：${payload.message}`;
      await this.appendAssistant(session.id, text);
      emit({ type: "assistant", data: { text } });
      return session.id;
    } finally {
      emit({ type: "done", data: { sessionId: session.id } });
    }
  }

  async confirmOrder(sessionId: string, approvalId: string, quoteHash: string): Promise<PendingOrder> {
    const candidate = await this.store.getApproval(approvalId);
    if (!candidate || candidate.sessionId !== sessionId) {
      throw new AppError("APPROVAL_NOT_FOUND", "确认信息不存在或不属于当前会话", 404);
    }
    const recalculatedHash = calculateQuoteHash(this.provider.name, candidate.quote);
    if (!sameQuoteHash(recalculatedHash, candidate.quote.quoteHash)) {
      throw new AppError("QUOTE_INTEGRITY_ERROR", "服务端报价完整性校验失败，请重新核价", 409);
    }
    const approval = await this.store.claimApproval(sessionId, approvalId, quoteHash);

    // 这是唯一允许触发真实写操作的位置；失败或未知状态均不自动重试。
    await this.store.addAudit(sessionId, "create_order_attempt", { approvalId, quoteHash }, "create-order");
    const createStartedAt = Date.now();
    let order: PendingOrder;
    try {
      order = await this.provider.createOrder({
        context: approval.quote.context,
        items: approval.quote.items,
      });
    } catch (error) {
      const uncertain = error instanceof AppError && [
        "MCP_TIMEOUT",
        "MCP_NETWORK_ERROR",
        "MCP_RATE_LIMIT",
        "MCP_HTTP_ERROR",
      ].includes(error.code);
      await this.store.markApproval(approvalId, uncertain ? "unknown" : "failed");
      await this.store.addAudit(
        sessionId,
        uncertain ? "create_order_unknown" : "create_order_failed",
        {
          approvalId,
          errorCode: error instanceof AppError ? error.code : "UNKNOWN_ERROR",
          durationMs: Date.now() - createStartedAt,
        },
        "create-order",
      );
      throw error;
    }
    await this.store.markApproval(approvalId, "confirmed");
    await this.store.saveOrder(sessionId, order);
    await this.store.addAudit(
      sessionId,
      "create_order_success",
      { orderId: order.orderId, totalAmount: order.totalAmount, durationMs: Date.now() - createStartedAt },
      "create-order",
    );
    await this.store.setCart(sessionId, []);
    return order;
  }

  async selectContext(
    sessionId: string,
    input: { addressId: string; storeCode: string; beCode: string },
  ): Promise<OrderContext> {
    if (!sessionId || !input.addressId || !input.storeCode || !input.beCode) {
      throw new AppError("CONTEXT_REQUIRED", "会话、配送地址和门店信息不能为空");
    }
    const [addresses, stores] = await Promise.all([
      this.provider.listAddresses(),
      this.provider.listDeliverableStores({ addressId: input.addressId, beType: 2 }),
    ]);
    const address = addresses.find((item) => item.addressId === input.addressId);
    const store = stores.find((item) => item.storeCode === input.storeCode && item.beCode === input.beCode);
    if (!address) throw new AppError("ADDRESS_NOT_FOUND", "没有找到所选配送地址", 404);
    if (!store) throw new AppError("STORE_NOT_FOUND", "没有找到所选可配送门店", 404);
    const context: OrderContext = {
      addressId: address.addressId,
      address,
      storeCode: store.storeCode,
      beCode: store.beCode,
      storeName: store.storeName,
    };
    await this.store.setContext(sessionId, context);
    return context;
  }

  private async runModel(sessionId: string, message: string, emit: (event: AgentEvent) => void): Promise<string> {
    const session = await this.store.getSession(sessionId);
    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      ...session.messages.map((item) => ({ role: item.role, content: item.content }) as LlmMessage),
    ];
    let finalText = "";
    const maxTurns = this.modelMaxTurns;
    for (let turn = 0; turn < maxTurns; turn += 1) {
      const response = await this.model!.chat(messages, tools);
      messages.push(response.message);
      const calls = response.message.tool_calls || [];
      if (!calls.length) {
        finalText = response.message.content || "我已经完成查询，请查看页面中的结果。";
        break;
      }
      for (const call of calls) {
        let args: Record<string, unknown>;
        try {
          const parsed = JSON.parse(call.function.arguments || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not-object");
          args = parsed as Record<string, unknown>;
        } catch {
          const payload = { code: "MODEL_TOOL_ARGUMENTS_INVALID", message: "模型返回的工具参数不是有效 JSON 对象" };
          messages.push({ role: "tool", tool_call_id: call.id, content: safeJson({ error: payload }) });
          emit({ type: "tool", data: { name: call.function.name, status: "failed", error: payload } });
          continue;
        }
        emit({ type: "tool", data: { name: call.function.name, status: "running", arguments: args } });
        try {
          const result = await this.executeTool(sessionId, call.function.name, args, emit);
          messages.push({ role: "tool", tool_call_id: call.id, content: safeJson(result) });
          emit({ type: "tool", data: { name: call.function.name, status: "success" } });
        } catch (error) {
          const payload = toErrorPayload(error);
          messages.push({ role: "tool", tool_call_id: call.id, content: safeJson({ error: payload }) });
          emit({ type: "tool", data: { name: call.function.name, status: "failed", error: payload } });
        }
      }
    }
    if (!finalText) finalText = "模型没有在规定轮次内完成处理，请把需求说得更具体一些。";
    await this.appendAssistant(sessionId, finalText);
    emit({ type: "assistant", data: { text: finalText } });
    return sessionId;
  }

  private async executeTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
    emit: (event: AgentEvent) => void,
  ): Promise<unknown> {
    const session = await this.store.getSession(sessionId);
    if (name === "list_delivery_addresses") {
      const addresses = await this.provider.listAddresses();
      emit({ type: "addresses", data: addresses });
      return { addresses };
    }
    if (name === "list_deliverable_stores") {
      const addressId = String(args.addressId || session.context?.addressId || "");
      if (!addressId) throw new AppError("ADDRESS_REQUIRED", "请先提供配送地址");
      const stores = await this.provider.listDeliverableStores({ addressId, beType: 2 });
      emit({ type: "stores", data: stores });
      // 模型工具链没有把“选中的门店”暴露成写操作；查询到门店后先建立一个
      // 明确的默认上下文，后续菜单、加购和核价都仍以工具返回值为准。
      if (addressId && stores[0] && (!session.context || session.context.addressId !== addressId)) {
        const addresses = await this.provider.listAddresses();
        const address = addresses.find((item) => item.addressId === addressId);
        if (!address) throw new AppError("ADDRESS_NOT_FOUND", "没有找到所选配送地址", 404);
        await this.store.setContext(sessionId, {
          addressId,
          address,
          storeCode: stores[0].storeCode,
          beCode: stores[0].beCode,
          storeName: stores[0].storeName,
        });
      }
      return { stores };
    }
    if (name === "list_menu") {
      const context = session.context;
      const storeCode = String(args.storeCode || context?.storeCode || "");
      const beCode = String(args.beCode || context?.beCode || "");
      if (!storeCode || !beCode) throw new AppError("STORE_REQUIRED", "请先选择可配送门店");
      if (context && (context.storeCode !== storeCode || context.beCode !== beCode)) {
        const stores = await this.provider.listDeliverableStores({ addressId: context.addressId, beType: 2 });
        const store = stores.find((item) => item.storeCode === storeCode && item.beCode === beCode);
        if (!store) throw new AppError("STORE_NOT_FOUND", "没有找到所选可配送门店", 404);
        await this.store.setContext(sessionId, { ...context, storeCode, beCode, storeName: store.storeName });
      }
      const menu = await this.provider.listMeals({ storeCode, beCode, orderType: 2, beType: 2 });
      emit({ type: "menu", data: menu });
      return { menu };
    }
    if (name === "get_meal_detail") {
      const code = String(args.code || "");
      const storeCode = String(args.storeCode || session.context?.storeCode || "");
      const beCode = String(args.beCode || session.context?.beCode || "");
      if (!code || !storeCode || !beCode) throw new AppError("PRODUCT_CODE_REQUIRED", "请提供门店和餐品编码");
      const detail = toMealDetailView(await this.provider.getMealDetail({
        storeCode,
        beCode,
        code,
        orderType: 2,
        beType: 2,
      }));
      emit({ type: "meal_detail", data: detail });
      return detail;
    }
    if (name === "list_store_coupons") {
      const storeCode = String(args.storeCode || session.context?.storeCode || "");
      const beCode = String(args.beCode || session.context?.beCode || "");
      if (!storeCode || !beCode) throw new AppError("STORE_REQUIRED", "请先选择可配送门店");
      const coupons = toCouponViews(await this.provider.listStoreCoupons({
        storeCode,
        beCode,
        orderType: 2,
        beType: 2,
      }));
      emit({ type: "coupons", data: coupons });
      return { coupons };
    }
    if (name === "add_to_cart") {
      if (!session.context) throw new AppError("CONTEXT_REQUIRED", "请先选择配送地址和门店");
      const productCode = String(args.productCode || "");
      const quantity = int(args.quantity, 0);
      if (!productCode || quantity < 1 || quantity > 20) {
        throw new AppError("INVALID_CART_ITEM", "餐品编码或数量无效");
      }
      const menu = await this.provider.listMeals({
        storeCode: session.context.storeCode,
        beCode: session.context.beCode,
        orderType: 2,
        beType: 2,
      });
      const catalogItem = menu.find((item) => item.productCode === productCode);
      if (!catalogItem) throw new AppError("ITEM_NOT_IN_MENU", "只能加入当前菜单中的餐品");
      const item: CartItem = {
        productCode,
        productName: catalogItem.name,
        quantity,
        unitPrice: catalogItem.price,
        ...(catalogItem.caloriesKcal === undefined ? {} : { caloriesKcal: catalogItem.caloriesKcal }),
        storeCode: session.context.storeCode,
        beCode: session.context.beCode,
      };
      const existing = session.cart.find((value) => value.productCode === item.productCode);
      const cart = existing
        ? (() => {
            if (existing.quantity + item.quantity > 20) throw new AppError("CART_QUANTITY_LIMIT", "同一餐品数量不能超过 20");
            return session.cart.map((value) => {
              if (value.productCode !== item.productCode) return value;
              const updated = {
                ...value,
                quantity: value.quantity + item.quantity,
                unitPrice: item.unitPrice,
                productName: item.productName,
              };
              if (item.caloriesKcal === undefined) delete updated.caloriesKcal;
              else updated.caloriesKcal = item.caloriesKcal;
              return updated;
            });
          })()
        : [...session.cart, item];
      await this.store.setCart(sessionId, cart);
      emit({ type: "cart", data: cart });
      return { cart };
    }
    if (name === "view_cart") {
      emit({ type: "cart", data: session.cart });
      return { cart: session.cart };
    }
    if (name === "calculate_price") {
      if (!session.context) throw new AppError("CONTEXT_REQUIRED", "请先选择配送地址和门店");
      const requestedItems = Array.isArray(args.items) ? args.items : [];
      let cart = session.cart;
      if (requestedItems.length) {
        cart = requestedItems.map((value) => {
          const item = asRecord(value);
          const previous = session.cart.find((candidate) => candidate.productCode === String(item.productCode));
          if (!previous) throw new AppError("ITEM_NOT_IN_CART", `餐品 ${String(item.productCode)} 不在购物车中`);
          const quantity = Number(item.quantity);
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
            throw new AppError("INVALID_QUANTITY", "核价数量必须是 1 到 20 的整数");
          }
          return { ...previous, quantity };
        });
        await this.store.setCart(sessionId, cart);
      }
      if (!cart.length) throw new AppError("EMPTY_CART", "购物车还是空的");
      const quote = finalizeQuote(this.provider.name, await this.provider.calculatePrice({ context: session.context, items: cart }));
      const approval = await this.store.createApproval(sessionId, quote);
      const data = { ...toPriceQuoteView(quote), approvalId: approval.approvalId };
      emit({ type: "quote", data });
      emit({ type: "confirmation_required", data });
      return data;
    }
    if (name === "get_order_status") {
      const orderId = String(args.orderId || "");
      if (!orderId) throw new AppError("ORDER_ID_REQUIRED", "请提供订单号");
      const order = await this.provider.getOrderStatus(orderId);
      await this.store.saveOrder(sessionId, order);
      const view = toPendingOrderView(order);
      emit({ type: "order", data: view });
      return view;
    }
    throw new AppError("TOOL_NOT_ALLOWED", `工具 ${name} 未被允许调用`, 403);
  }

  private async runMockAgent(sessionId: string, message: string, emit: (event: AgentEvent) => void): Promise<string> {
    const normalized = message.toLowerCase();
    if (normalized.includes("订单") || normalized.includes("进度") || normalized.includes("状态")) {
      const latestOrder = await this.store.getLatestOrder(sessionId);
      if (latestOrder) {
        const order = await this.provider.getOrderStatus(latestOrder.order.orderId);
        await this.store.saveOrder(sessionId, order);
        emit({ type: "order", data: toPendingOrderView(order) });
        const text = `订单 ${order.orderId} 当前状态：${order.orderStatus}。`;
        await this.appendAssistant(sessionId, text);
        emit({ type: "assistant", data: { text } });
        return sessionId;
      }
      const text = "当前会话还没有已创建的订单。你可以先选择餐品并完成核价。";
      await this.appendAssistant(sessionId, text);
      emit({ type: "assistant", data: { text } });
      return sessionId;
    }

    const context = await this.ensureMockContext(sessionId, emit);
    const menu = await this.provider.listMeals({ storeCode: context.storeCode, beCode: context.beCode, orderType: 2, beType: 2 });
    const requestedMeal = this.findRequestedMeal(normalized, menu);
    const wantsDetail = normalized.includes("详情") || normalized.includes("规格") || normalized.includes("组成") || normalized.includes("配料");
    const wantsCoupons = normalized.includes("优惠") || normalized.includes("优惠券") || normalized.includes("折扣");

    if (wantsDetail && requestedMeal) {
      await this.executeTool(sessionId, "get_meal_detail", {
        storeCode: context.storeCode,
        beCode: context.beCode,
        code: requestedMeal.productCode,
      }, emit);
      const text = `已展示${requestedMeal.name}的套餐组成和可选规格，请查看右侧详情卡片。`;
      await this.appendAssistant(sessionId, text);
      emit({ type: "assistant", data: { text } });
      return sessionId;
    }

    if (wantsCoupons) {
      await this.executeTool(sessionId, "list_store_coupons", {
        storeCode: context.storeCode,
        beCode: context.beCode,
      }, emit);
      const text = "已查询当前门店可用优惠，请查看右侧优惠卡片；优惠以当前门店和核价结果为准。";
      await this.appendAssistant(sessionId, text);
      emit({ type: "assistant", data: { text } });
      return sessionId;
    }

    let current = await this.store.getSession(sessionId);
    if (requestedMeal && !current.cart.some((item) => item.productCode === requestedMeal.productCode)) {
      const cartItem: CartItem = {
        productCode: requestedMeal.productCode,
        productName: requestedMeal.name,
        quantity: 1,
        unitPrice: requestedMeal.price,
        ...(requestedMeal.caloriesKcal === undefined ? {} : { caloriesKcal: requestedMeal.caloriesKcal }),
        storeCode: context.storeCode,
        beCode: context.beCode,
      };
      current = await this.store.setCart(sessionId, [...current.cart, cartItem]);
      emit({ type: "cart", data: current.cart });
    }

    if (normalized.includes("清空") || normalized.includes("不要了")) {
      current = await this.store.setCart(sessionId, []);
      emit({ type: "cart", data: [] });
      const text = "购物车已清空。你可以继续告诉我想吃什么。";
      await this.appendAssistant(sessionId, text);
      emit({ type: "assistant", data: { text } });
      return sessionId;
    }

    const shouldQuote = normalized.includes("核价") || normalized.includes("价格") || normalized.includes("下单") || Boolean(requestedMeal);
    if (shouldQuote && current.cart.length) {
      await this.executeTool(sessionId, "calculate_price", {}, emit);
      const text = "我已经根据当前门店和购物车完成核价，请核对订单卡片中的地址、商品和总价；确认后再点击创建待支付订单。";
      await this.appendAssistant(sessionId, text);
      emit({ type: "assistant", data: { text } });
      return sessionId;
    }

    emit({ type: "menu", data: menu });
    const text = "我查到了当前可配送门店和菜单。你可以点击餐品加入购物车，也可以直接告诉我想吃的餐品、数量或预算。";
    await this.appendAssistant(sessionId, text);
    emit({ type: "assistant", data: { text } });
    return sessionId;
  }

  private async ensureMockContext(sessionId: string, emit: (event: AgentEvent) => void): Promise<OrderContext> {
    const session = await this.store.getSession(sessionId);
    if (session.context) return session.context;
    const addresses = await this.provider.listAddresses();
    emit({ type: "addresses", data: addresses });
    const address = addresses[0];
    if (!address) throw new AppError("ADDRESS_NOT_FOUND", "当前没有可用配送地址", 404);
    const stores = await this.provider.listDeliverableStores({ addressId: address.addressId, beType: 2 });
    emit({ type: "stores", data: stores });
    const store = stores[0];
    if (!store) throw new AppError("STORE_NOT_FOUND", "当前地址没有可配送门店", 404);
    const context: OrderContext = {
      addressId: address.addressId,
      address,
      storeCode: store.storeCode,
      beCode: store.beCode,
      storeName: store.storeName,
    };
    await this.store.setContext(sessionId, context);
    return context;
  }

  private findRequestedMeal(message: string, menu: MenuItem[]): MenuItem | undefined {
    return menu.find((item) => message.includes(item.name.toLowerCase()) || (message.includes("麦香鸡") && item.name.includes("麦香鸡")) || (message.includes("鸡翅") && item.name.includes("鸡翅")) || (message.includes("吉士") && item.name.includes("吉士")));
  }

  private async appendAssistant(sessionId: string, text: string): Promise<void> {
    await this.store.appendMessage(sessionId, "assistant", text);
  }
}

export function createModelTools(): LlmTool[] {
  return tools;
}
