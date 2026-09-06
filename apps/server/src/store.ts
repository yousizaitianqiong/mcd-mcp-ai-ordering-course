import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

export class JsonStore {
  private state: AppState = emptyState();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const text = await fs.readFile(this.file, "utf8");
      this.state = { ...emptyState(), ...(JSON.parse(text) as AppState) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = emptyState();
    }
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
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

  async setCart(sessionId: string, cart: CartItem[]): Promise<SessionState> {
    await this.ensureSession(sessionId);
    this.state.sessions[sessionId].cart = cart;
    this.state.sessions[sessionId].updatedAt = new Date().toISOString();
    await this.persist();
    return structuredClone(this.state.sessions[sessionId]);
  }

  async setContext(sessionId: string, context: OrderContext): Promise<SessionState> {
    await this.ensureSession(sessionId);
    this.state.sessions[sessionId].context = context;
    this.state.sessions[sessionId].updatedAt = new Date().toISOString();
    await this.persist();
    return structuredClone(this.state.sessions[sessionId]);
  }

  async createApproval(
    sessionId: string,
    quote: PriceQuote,
  ): Promise<ApprovalRecord> {
    await this.ensureSession(sessionId);
    const approval: ApprovalRecord = {
      approvalId: randomUUID(),
      sessionId,
      quote,
      status: "pending",
      expiresAt: quote.expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.state.approvals[approval.approvalId] = approval;
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
