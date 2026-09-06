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
  ) {}

  async chat(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResponse> {
    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
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
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new AppError("MODEL_NETWORK_ERROR", "无法连接在线模型 API", 502, error);
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new AppError("MODEL_HTTP_ERROR", `模型 API 返回 HTTP ${response.status}`, response.status, payload);
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = (choices[0] || {}) as Record<string, unknown>;
    const message = (first.message || {}) as Record<string, unknown>;
    return {
      message: {
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        tool_calls: Array.isArray(message.tool_calls)
          ? message.tool_calls.map((call) => {
              const value = call as Record<string, unknown>;
              const fn = (value.function || {}) as Record<string, unknown>;
              return {
                id: String(value.id || `call-${Date.now()}`),
                type: "function" as const,
                function: {
                  name: String(fn.name || ""),
                  arguments: String(fn.arguments || "{}"),
                },
              };
            })
          : undefined,
      },
      finishReason: typeof first.finish_reason === "string" ? first.finish_reason : undefined,
    };
  }
}
