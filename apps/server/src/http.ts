import fs from "node:fs/promises";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { AppError, toErrorPayload } from "./errors.js";
import type { AppConfig } from "./config.js";
import { OrderingOrchestrator } from "./orchestrator.js";
import type { JsonStore } from "./store.js";
import type { FoodOrderProvider } from "./types.js";

interface Dependencies {
  config: AppConfig;
  store: JsonStore;
  provider: FoodOrderProvider;
  orchestrator: OrderingOrchestrator;
  modelConfigured: boolean;
}

const MAX_BODY_BYTES = 128 * 1024;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new AppError("REQUEST_TOO_LARGE", "请求体过大", 413);
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not-object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AppError("INVALID_JSON", "请求体不是有效 JSON", 400);
  }
}

function cors(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Vary", "Origin");
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

function sendError(response: ServerResponse, error: unknown): void {
  const payload = toErrorPayload(error);
  const status = error instanceof AppError ? error.status : 500;
  sendJson(response, status, { error: payload });
}

function sse(response: ServerResponse, type: string, data: unknown): void {
  response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method !== "GET") return false;
  const webDistCandidates = [
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "apps/web/dist"),
  ];
  let webDist: string | undefined;
  for (const candidate of webDistCandidates) {
    try {
      await fs.access(path.join(candidate, "index.html"));
      webDist = candidate;
      break;
    } catch {
      // 继续尝试另一个工作目录布局。
    }
  }
  if (!webDist) return false;
  const requested = new URL(request.url || "/", "http://localhost").pathname;
  const relative = requested === "/" ? "index.html" : requested.replace(/^\//, "");
  const candidate = path.resolve(webDist, relative);
  if (!candidate.startsWith(webDist)) return false;
  try {
    const data = await fs.readFile(candidate);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType(candidate));
    response.end(data);
    return true;
  } catch {
    if (requested !== "/") {
      try {
        const data = await fs.readFile(path.join(webDist, "index.html"));
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function createHttpServer(deps: Dependencies) {
  return createServer(async (request, response) => {
    cors(response, deps.config.origin);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          mode: deps.config.mode,
          provider: deps.provider.name,
          modelConfigured: deps.modelConfigured,
          mcpConfigured: Boolean(deps.config.mcdToken),
          protocolVersion: deps.config.mcdProtocolVersion,
          now: new Date().toISOString(),
        });
        return;
      }

      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body = await readJson(request);
        const message = String(body.message || "").trim();
        if (!message) throw new AppError("MESSAGE_REQUIRED", "请输入想点的餐品或需求");
        if (message.length > 4000) throw new AppError("MESSAGE_TOO_LONG", "消息长度不能超过 4000 个字符");
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache, no-transform");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();
        await deps.orchestrator.chat(
          typeof body.sessionId === "string" ? body.sessionId : undefined,
          message,
          (event) => sse(response, event.type, event.data),
        );
        response.end();
        return;
      }

      if (url.pathname === "/api/context" && request.method === "POST") {
        const body = await readJson(request);
        const sessionId = String(body.sessionId || "");
        const context = await deps.orchestrator.selectContext(sessionId, {
          addressId: String(body.addressId || ""),
          storeCode: String(body.storeCode || ""),
          beCode: String(body.beCode || ""),
        });
        sendJson(response, 200, { context });
        return;
      }

      if (url.pathname === "/api/cart" && request.method === "POST") {
        const body = await readJson(request);
        const sessionId = String(body.sessionId || "");
        if (!sessionId) throw new AppError("SESSION_REQUIRED", "缺少会话 ID");
        const session = await deps.store.ensureSession(sessionId);
        if (body.action === "clear") {
          const updated = await deps.store.setCart(session.id, []);
          sendJson(response, 200, { sessionId: updated.id, cart: updated.cart });
          return;
        }
        const item = (body.item || {}) as Record<string, unknown>;
        if (!item.productCode || !item.productName || !Number.isFinite(Number(item.unitPrice))) {
          throw new AppError("INVALID_CART_ITEM", "购物车餐品信息不完整");
        }
        if (!session.context) throw new AppError("CONTEXT_REQUIRED", "请先通过聊天查询地址和门店");
        const quantity = Number(item.quantity || 1);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
          throw new AppError("INVALID_CART_ITEM", "餐品数量必须是 1 到 20 的整数");
        }
        const menu = await deps.provider.listMeals({
          storeCode: session.context.storeCode,
          beCode: session.context.beCode,
          orderType: 2,
          beType: 2,
        });
        const catalogItem = menu.find((candidate) => candidate.productCode === String(item.productCode));
        if (!catalogItem) throw new AppError("ITEM_NOT_IN_MENU", "只能加入当前菜单中的餐品", 400);
        const existing = session.cart.find((candidate) => candidate.productCode === catalogItem.productCode);
        if (existing && existing.quantity + quantity > 20) {
          throw new AppError("CART_QUANTITY_LIMIT", "同一餐品数量不能超过 20");
        }
        const cart = existing
          ? session.cart.map((candidate) => {
              if (candidate.productCode !== catalogItem.productCode) return candidate;
              const updated = {
                ...candidate,
                productName: catalogItem.name,
                quantity: candidate.quantity + quantity,
                unitPrice: catalogItem.price,
              };
              if (catalogItem.caloriesKcal === undefined) delete updated.caloriesKcal;
              else updated.caloriesKcal = catalogItem.caloriesKcal;
              return updated;
            })
          : [...session.cart, {
              productCode: catalogItem.productCode,
              productName: catalogItem.name,
              quantity,
              unitPrice: catalogItem.price,
              ...(catalogItem.caloriesKcal === undefined ? {} : { caloriesKcal: catalogItem.caloriesKcal }),
              storeCode: session.context.storeCode,
              beCode: session.context.beCode,
            }];
        const updated = await deps.store.setCart(session.id, cart);
        await deps.store.addAudit(session.id, "cart_update", { item: item.productCode });
        sendJson(response, 200, { sessionId: updated.id, cart: updated.cart });
        return;
      }

      if (url.pathname === "/api/orders/confirm" && request.method === "POST") {
        const body = await readJson(request);
        const sessionId = String(body.sessionId || "");
        const approvalId = String(body.approvalId || "");
        const quoteHash = String(body.quoteHash || "");
        if (!sessionId || !approvalId || !quoteHash) {
          throw new AppError("CONFIRMATION_FIELDS_REQUIRED", "缺少会话、确认信息或报价哈希");
        }
        const order = await deps.orchestrator.confirmOrder(sessionId, approvalId, quoteHash);
        sendJson(response, 200, { order });
        return;
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (orderMatch && request.method === "GET") {
        const orderId = decodeURIComponent(orderMatch[1]);
        const stored = await deps.store.getOrder(orderId);
        if (stored) {
          sendJson(response, 200, { order: stored.order });
          return;
        }
        const order = await deps.provider.getOrderStatus(orderId);
        sendJson(response, 200, { order });
        return;
      }

      if (await serveStatic(request, response)) return;
      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else response.end();
    }
  });
}
