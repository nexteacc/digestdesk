export class AppError extends Error {
  code: string;
  status: number;

  constructor(message: string, status = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (err instanceof Error) {
    return new AppError(err.message || "请求失败", 500, "UNEXPECTED_ERROR");
  }

  return new AppError("请求失败", 500, "UNEXPECTED_ERROR");
}
