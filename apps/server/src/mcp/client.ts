import { AppError } from "../errors.js";

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
  let latest: unknown;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try {
      latest = JSON.parse(value);
    } catch {
      // 忽略非 JSON 的服务端事件，最终交给上层显示原始结果。
    }
  }
  return latest;
}

async function parseResponse(response: Response): Promise<JsonRpcResponse | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  const contentType = response.headers.get("content-type") || "";
  const parsed = contentType.includes("text/event-stream") ? parseSse(text) : JSON.parse(text);
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
      const parsed = await parseResponse(response);
      if (!response.ok) {
        throw new AppError(
          response.status === 401 ? "MCP_UNAUTHORIZED" : response.status === 429 ? "MCP_RATE_LIMIT" : "MCP_HTTP_ERROR",
          `麦当劳 MCP 返回 HTTP ${response.status}`,
          response.status,
          parsed,
        );
      }
      if (parsed?.error) {
        throw new AppError(
          "MCP_RPC_ERROR",
          parsed.error.message || "麦当劳 MCP 调用失败",
          502,
          parsed.error.data,
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("MCP_TIMEOUT", "麦当劳 MCP 请求超时", 504);
      }
      throw new AppError("MCP_NETWORK_ERROR", "无法连接麦当劳 MCP 服务", 502, error);
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
    const result = (response?.result || {}) as { tools?: RemoteToolDefinition[] };
    return result.tools || [];
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
  if (record.success === false) {
    throw new AppError("MCP_TOOL_ERROR", String(record.message || "远程工具执行失败"), 502, record);
  }
  return record.data ?? value;
}
