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

export function toErrorPayload(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error) return { code: "INTERNAL_ERROR", message: error.message };
  return { code: "INTERNAL_ERROR", message: "发生了未知错误" };
}
