import { AppError } from "./errors.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmResponse {
  message: LlmMessage;
  finishReason?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function modelHttpError(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError("MODEL_UNAUTHORIZED", "在线模型鉴权失败", status);
  }
  if (status === 429) {
    return new AppError("MODEL_RATE_LIMIT", "在线模型请求受到限流", status);
  }
  return new AppError("MODEL_HTTP_ERROR", `模型 API 返回 HTTP ${status}`, status);
}

function parseModelResponse(payload: unknown): LlmResponse {
  const root = asRecord(payload);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = asRecord(choices[0]);
  const rawMessage = first.message;
  if (!rawMessage || typeof rawMessage !== "object") {
    throw new AppError("MODEL_INVALID_RESPONSE", "模型 API 未返回有效消息", 502);
  }
  const message = asRecord(rawMessage);
  const rawCalls = message.tool_calls;
  let toolCalls: LlmMessage["tool_calls"];
  if (rawCalls !== undefined) {
    if (!Array.isArray(rawCalls)) {
      throw new AppError("MODEL_INVALID_RESPONSE", "模型工具调用格式无效", 502);
    }
    toolCalls = rawCalls.map((rawCall, index) => {
      const call = asRecord(rawCall);
      const fn = asRecord(call.function);
      const name = typeof fn.name === "string" ? fn.name.trim() : "";
      const args = typeof fn.arguments === "string" ? fn.arguments : "";
      if (!name || !args) {
        throw new AppError("MODEL_INVALID_RESPONSE", `第 ${index + 1} 个模型工具调用缺少名称或参数`, 502);
      }
      return {
        id: typeof call.id === "string" && call.id ? call.id : `model-call-${index + 1}`,
        type: "function" as const,
        function: { name, arguments: args },
      };
    });
  }
  const content = message.content === null || typeof message.content === "string"
    ? message.content
    : undefined;
  if (content === undefined && !toolCalls?.length) {
    throw new AppError("MODEL_INVALID_RESPONSE", "模型消息既没有文本也没有工具调用", 502);
  }
  return {
    message: {
      role: "assistant",
      content: content ?? null,
      tool_calls: toolCalls,
    },
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : undefined,
  };
}

export interface ModelAdapter {
  readonly name: string;
  chat(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResponse>;
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly name = "openai-compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async chat(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResponse> {
    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools,
          tool_choice: "auto",
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new AppError("MODEL_TIMEOUT", "在线模型请求超时", 504);
      }
      throw new AppError("MODEL_NETWORK_ERROR", "无法连接在线模型 API", 502);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (!response.ok) throw modelHttpError(response.status);
        throw new AppError("MODEL_INVALID_RESPONSE", "模型 API 返回的不是有效 JSON", 502);
      }
    }
    if (!response.ok) throw modelHttpError(response.status);
    return parseModelResponse(payload);
  }
}
