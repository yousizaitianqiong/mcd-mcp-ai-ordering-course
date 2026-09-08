import { AppError } from "../errors.js";

function safeRemoteMessage(value: unknown): string {
  return String(value || "远程工具执行失败")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|token|authorization))\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 300);
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface RemoteToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

function parseSse(text: string): unknown {
  const events: unknown[] = [];
  let dataLines: string[] = [];
  const flush = (): void => {
    const value = dataLines.join("\n").trim();
    dataLines = [];
    if (!value || value === "[DONE]") return;
    try {
      events.push(JSON.parse(value));
    } catch {
      // 非 JSON 事件不应覆盖前一个有效 MCP 响应。
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  flush();
  return events.length ? events[events.length - 1] : undefined;
}

async function parseResponse(response: Response): Promise<JsonRpcResponse | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  const contentType = response.headers.get("content-type") || "";
  let parsed: unknown;
  try {
    parsed = contentType.includes("text/event-stream") ? parseSse(text) : JSON.parse(text);
  } catch {
    throw new AppError("MCP_INVALID_RESPONSE", "麦当劳 MCP 返回了无效 JSON", 502);
  }
  if (parsed === undefined) throw new AppError("MCP_INVALID_RESPONSE", "麦当劳 MCP 没有返回有效事件", 502);
  return parsed as JsonRpcResponse;
}

export class McpHttpClient {
  private requestId = 0;
  private sessionId?: string;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly protocolVersion = "2025-06-18",
    private readonly timeoutMs = 30_000,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async post(message: Record<string, unknown>): Promise<JsonRpcResponse | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      const sessionId = response.headers.get("mcp-session-id") || response.headers.get("Mcp-Session-Id");
      if (sessionId) this.sessionId = sessionId;
      let parsed: JsonRpcResponse | null;
      try {
        parsed = await parseResponse(response);
      } catch (error) {
        if (!response.ok) parsed = null;
        else throw error;
      }
      if (!response.ok) {
        throw new AppError(
          response.status === 401 ? "MCP_UNAUTHORIZED" : response.status === 429 ? "MCP_RATE_LIMIT" : "MCP_HTTP_ERROR",
          `麦当劳 MCP 返回 HTTP ${response.status}`,
          response.status,
          { status: response.status },
        );
      }
      if (parsed?.error) {
        throw new AppError(
          "MCP_RPC_ERROR",
          safeRemoteMessage(parsed.error.message || "麦当劳 MCP 调用失败"),
          502,
          parsed.error.data,
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new AppError("MCP_TIMEOUT", "麦当劳 MCP 请求超时", 504);
      }
      throw new AppError("MCP_NETWORK_ERROR", "无法连接麦当劳 MCP 服务", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const response = await this.post({
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "initialize",
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: { name: "mcd-ai-ordering-course", version: "0.1.0" },
      },
    });
    if (!response?.result) throw new AppError("MCP_INIT_FAILED", "麦当劳 MCP 初始化失败", 502, response);
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.initialized = true;
  }

  async listTools(): Promise<RemoteToolDefinition[]> {
    await this.initialize();
    const response = await this.post({
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "tools/list",
      params: {},
    });
    const result = (response?.result || {}) as { tools?: unknown };
    if (!Array.isArray(result.tools)) {
      throw new AppError("MCP_INVALID_TOOLS", "麦当劳 MCP 未返回有效工具列表", 502);
    }
    return result.tools.map((tool, index) => {
      if (!tool || typeof tool !== "object") {
        throw new AppError("MCP_INVALID_TOOLS", `第 ${index + 1} 个远端工具格式无效`, 502);
      }
      const value = tool as Record<string, unknown>;
      if (typeof value.name !== "string" || !value.name.trim()) {
        throw new AppError("MCP_INVALID_TOOLS", `第 ${index + 1} 个远端工具缺少名称`, 502);
      }
      if (!value.inputSchema || typeof value.inputSchema !== "object") {
        throw new AppError("MCP_INVALID_TOOLS", `远端工具 ${value.name} 缺少 inputSchema`, 502);
      }
      return {
        name: value.name,
        title: typeof value.title === "string" ? value.title : undefined,
        description: typeof value.description === "string" ? value.description : undefined,
        inputSchema: value.inputSchema as Record<string, unknown>,
      };
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialize();
    const response = await this.post({
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "tools/call",
      params: { name, arguments: args },
    });
    return response?.result ?? response;
  }
}

export function extractMcpData(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (record.structuredContent) return record.structuredContent;
  const content = record.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const text = (block as Record<string, unknown>).text;
      if (typeof text !== "string") continue;
      try {
        return JSON.parse(text);
      } catch {
        return { rawText: text };
      }
    }
  }
  return result;
}

export function unwrapMcpData(result: unknown): unknown {
  const value = extractMcpData(result);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.success === false || record.isError === true) {
    throw new AppError("MCP_TOOL_ERROR", safeRemoteMessage(record.message), 502);
  }
  return record.data ?? value;
}
