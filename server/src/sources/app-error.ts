export class AppError extends Error {
  code: string;
  status: number;
  messageZh: string;

  constructor(message: string, status = 500, code = "INTERNAL_ERROR", messageZh?: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.messageZh = messageZh ?? message;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (err instanceof Error) {
    return new AppError(err.message || "Request failed", 500, "UNEXPECTED_ERROR", err.message || "请求失败");
  }

  return new AppError("Request failed", 500, "UNEXPECTED_ERROR", "请求失败");
}
