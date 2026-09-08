export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function publicMessage(value: string): string {
  return value
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|token|authorization))\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

export function toErrorPayload(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof AppError) {
    // details 只供服务端调试使用，绝不通过 HTTP/SSE 暴露，避免泄露 Token、请求体或下游原始响应。
    return { code: error.code, message: publicMessage(error.message) };
  }
  if (error instanceof Error) return { code: "INTERNAL_ERROR", message: publicMessage(error.message) };
  return { code: "INTERNAL_ERROR", message: "发生了未知错误" };
}
