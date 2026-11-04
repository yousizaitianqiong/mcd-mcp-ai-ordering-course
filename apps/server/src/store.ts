import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { sameQuoteHash } from "./quote.js";
import type {
  AppState,
  ApprovalRecord,
  AuditEvent,
  CartItem,
  MessageRole,
  OrderContext,
  PendingOrder,
  PriceQuote,
  SessionState,
  StoredMessage,
  StoredOrder,
} from "./types.js";

const emptyState = (): AppState => ({
  sessions: {},
  approvals: {},
  orders: {},
  audit: [],
});

function safeAddress(address: OrderContext["address"]): OrderContext["address"] {
  return {
    addressId: address.addressId,
    contactName: "已脱敏联系人",
    phone: "已脱敏手机号",
    fullAddress: "已脱敏配送地址",
  };
}

function redactText(value: string): string {
  return value
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|token|authorization))\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b1\d{10}\b/g, "[REDACTED_PHONE]");
}

function safeState(state: AppState): AppState {
  const snapshot = structuredClone(state);
  for (const session of Object.values(snapshot.sessions)) {
    if (session.context) session.context = { ...session.context, address: safeAddress(session.context.address) };
    session.messages = session.messages.map((message) => ({ ...message, content: redactText(message.content) }));
  }
  for (const approval of Object.values(snapshot.approvals)) {
    approval.quote.context = { ...approval.quote.context, address: safeAddress(approval.quote.context.address) };
  }
  for (const stored of Object.values(snapshot.orders)) {
    if (stored.order.deliveryAddress) stored.order.deliveryAddress = "已脱敏配送地址";
    stored.order.payH5Url = undefined;
  }
  return snapshot;
}

export class JsonStore {
  private state: AppState = emptyState();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = emptyState();
      return;
    }
    this.state = { ...emptyState(), ...(JSON.parse(text) as AppState) };
    let changed = false;
    const legacySessions = new Set<string>();
    for (const session of Object.values(this.state.sessions)) {
      if (!Number.isSafeInteger(session.revision) || (session.revision ?? -1) < 0) {
        legacySessions.add(session.id);
        session.revision = 0;
        changed = true;
      }
    }
    for (const approval of Object.values(this.state.approvals)) {
      if (approval.status === "submitting") {
        approval.status = "unknown";
        changed = true;
      } else if (approval.status === "pending" && (
        !Number.isSafeInteger(approval.revision) || (approval.revision ?? -1) < 0 ||
        legacySessions.has(approval.sessionId) || !this.state.sessions[approval.sessionId]
      )) {
        approval.status = "invalidated";
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(safeState(this.state), null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, snapshot, "utf8");
    });
    await this.writeChain;
  }

  async ensureSession(id?: string): Promise<SessionState> {
    const sessionId = id || randomUUID();
    const existing = this.state.sessions[sessionId];
    if (existing) return structuredClone(existing);
    const session: SessionState = {
      id: sessionId,
      messages: [],
      cart: [],
      revision: 0,
      updatedAt: new Date().toISOString(),
    };
    this.state.sessions[sessionId] = session;
    await this.persist();
    return structuredClone(session);
  }

  async getSession(id: string): Promise<SessionState> {
    return this.ensureSession(id);
  }

  async appendMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
    toolName?: string,
  ): Promise<void> {
    const session = await this.ensureSession(sessionId);
    const message: StoredMessage = {
      id: randomUUID(),
      role,
      content,
      toolName,
      createdAt: new Date().toISOString(),
    };
    this.state.sessions[session.id].messages.push(message);
    this.state.sessions[session.id].updatedAt = message.createdAt;
    await this.persist();
  }

  private assertNotSubmitting(sessionId: string): void {
    if (Object.values(this.state.approvals).some((item) => item.sessionId === sessionId && item.status === "submitting")) {
      throw new AppError("ORDER_SUBMITTING", "订单正在提交，请稍后再调整购物车或配送信息", 409);
    }
  }

  private invalidatePending(sessionId: string): void {
    for (const approval of Object.values(this.state.approvals)) {
      if (approval.sessionId === sessionId && approval.status === "pending") approval.status = "invalidated";
    }
  }

  async updateCart(
    sessionId: string,
    update: (cart: CartItem[], session: SessionState) => CartItem[],
    expectedRevision?: number,
  ): Promise<SessionState> {
    await this.ensureSession(sessionId);
    const session = this.state.sessions[sessionId];
    this.assertNotSubmitting(sessionId);
    if (expectedRevision !== undefined && (session.revision ?? 0) !== expectedRevision) {
      throw new AppError("CART_CHANGED", "购物车或配送信息已变化，请重新操作", 409);
    }
    const next = update(structuredClone(session.cart), structuredClone(session));
    if (JSON.stringify(next) !== JSON.stringify(session.cart)) {
      session.cart = structuredClone(next);
      session.revision = (session.revision ?? 0) + 1;
      session.updatedAt = new Date().toISOString();
      this.invalidatePending(sessionId);
      await this.persist();
    }
    return structuredClone(session);
  }

  async setCart(sessionId: string, cart: CartItem[], expectedRevision?: number): Promise<SessionState> {
    return this.updateCart(sessionId, () => cart, expectedRevision);
  }

  async setContext(sessionId: string, context: OrderContext, expectedRevision?: number): Promise<SessionState> {
    await this.ensureSession(sessionId);
    const session = this.state.sessions[sessionId];
    this.assertNotSubmitting(sessionId);
    if (expectedRevision !== undefined && (session.revision ?? 0) !== expectedRevision) {
      throw new AppError("CART_CHANGED", "购物车或配送信息已变化，请重新操作", 409);
    }
    const current = session.context;
    const changed = !current || current.addressId !== context.addressId ||
      current.storeCode !== context.storeCode || current.beCode !== context.beCode ||
      current.storeName !== context.storeName || current.address.fullAddress !== context.address.fullAddress ||
      current.address.contactName !== context.address.contactName || current.address.phone !== context.address.phone;
    session.context = structuredClone(context);
    if (changed) {
      session.cart = [];
      session.revision = (session.revision ?? 0) + 1;
      this.invalidatePending(sessionId);
    }
    session.updatedAt = new Date().toISOString();
    await this.persist();
    return structuredClone(session);
  }

  async createApproval(
    sessionId: string,
    quote: PriceQuote,
    revision: number,
  ): Promise<ApprovalRecord> {
    await this.ensureSession(sessionId);
    this.assertNotSubmitting(sessionId);
    if ((this.state.sessions[sessionId].revision ?? 0) !== revision) {
      throw new AppError("QUOTE_STALE", "购物车或配送信息已变化，请重新核价", 409);
    }
    this.invalidatePending(sessionId);
    const approval: ApprovalRecord = {
      approvalId: randomUUID(),
      sessionId,
      quote,
      status: "pending",
      revision,
      expiresAt: quote.expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.state.approvals[approval.approvalId] = approval;
    await this.persist();
    return structuredClone(approval);
  }

  async claimApproval(sessionId: string, approvalId: string, quoteHash: string): Promise<ApprovalRecord> {
    const approval = this.state.approvals[approvalId];
    if (!approval || approval.sessionId !== sessionId) {
      throw new AppError("APPROVAL_NOT_FOUND", "确认信息不存在或不属于当前会话", 404);
    }
    if (approval.status === "confirmed") {
      throw new AppError("APPROVAL_ALREADY_USED", "这份订单确认已经使用过", 409);
    }
    if (approval.status === "invalidated") {
      throw new AppError("QUOTE_STALE", "报价已失效，请重新核价", 409);
    }
    if (approval.status !== "pending") {
      throw new AppError("APPROVAL_NOT_RETRYABLE", "这份订单确认已经进入终态，不能再次提交", 409);
    }
    this.assertNotSubmitting(sessionId);
    if (!this.state.sessions[sessionId] || !Number.isSafeInteger(approval.revision) || approval.revision !== this.state.sessions[sessionId].revision) {
      approval.status = "invalidated";
      await this.persist();
      throw new AppError("QUOTE_STALE", "购物车或配送信息已变化，请重新核价", 409);
    }
    if (Date.parse(approval.expiresAt) < Date.now()) {
      approval.status = "expired";
      await this.persist();
      throw new AppError("QUOTE_EXPIRED", "报价已过期，请重新核价", 409);
    }
    if (!sameQuoteHash(approval.quote.quoteHash, quoteHash)) {
      throw new AppError("QUOTE_HASH_MISMATCH", "报价内容已变化，请重新核价", 409);
    }
    // 在第一次 await 前占用 approval，保证同一进程内的并发确认只有一个进入 Provider。
    approval.status = "submitting";
    await this.persist();
    return structuredClone(approval);
  }

  async getApproval(id: string): Promise<ApprovalRecord | undefined> {
    const approval = this.state.approvals[id];
    return approval ? structuredClone(approval) : undefined;
  }

  async markApproval(id: string, status: ApprovalRecord["status"]): Promise<void> {
    const approval = this.state.approvals[id];
    if (!approval) return;
    approval.status = status;
    await this.persist();
  }

  async completeOrder(id: string, order: PendingOrder): Promise<void> {
    const approval = this.state.approvals[id];
    if (!approval || approval.status !== "submitting") {
      throw new AppError("APPROVAL_NOT_RETRYABLE", "订单确认状态异常，不能再次提交", 409);
    }
    const session = this.state.sessions[approval.sessionId];
    approval.status = "confirmed";
    this.state.orders[order.orderId] = { sessionId: approval.sessionId, order, createdAt: new Date().toISOString() };
    if (session && session.cart.length) {
      session.cart = [];
      session.revision = (session.revision ?? 0) + 1;
      session.updatedAt = new Date().toISOString();
    }
    this.invalidatePending(approval.sessionId);
    await this.persist();
  }

  async saveOrder(sessionId: string, order: PendingOrder): Promise<void> {
    const stored: StoredOrder = {
      sessionId,
      order,
      createdAt: new Date().toISOString(),
    };
    this.state.orders[order.orderId] = stored;
    await this.persist();
  }

  async getOrder(orderId: string): Promise<StoredOrder | undefined> {
    const order = this.state.orders[orderId];
    return order ? structuredClone(order) : undefined;
  }

  async getLatestOrder(sessionId: string): Promise<StoredOrder | undefined> {
    const latest = Object.values(this.state.orders)
      .filter((item) => item.sessionId === sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return latest ? structuredClone(latest) : undefined;
  }

  async addAudit(
    sessionId: string,
    eventType: string,
    payload?: unknown,
    toolName?: string,
  ): Promise<void> {
    const event: AuditEvent = {
      id: randomUUID(),
      sessionId,
      eventType,
      toolName,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.state.audit.push(event);
    this.state.audit = this.state.audit.slice(-1000);
    await this.persist();
  }

  summary(): { sessions: number; approvals: number; orders: number; auditEvents: number } {
    return {
      sessions: Object.keys(this.state.sessions).length,
      approvals: Object.keys(this.state.approvals).length,
      orders: Object.keys(this.state.orders).length,
      auditEvents: this.state.audit.length,
    };
  }
}
