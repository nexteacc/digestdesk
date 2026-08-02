export const AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000;
export const AUTH_BOOTSTRAP_RETRY_DELAYS_MS = [500, 1_500] as const;

export type AuthBootstrapFailureKind = "unauthorized" | "access-revoked" | "recoverable";

type ErrorDetails = {
  status?: number;
  code?: string;
};

export class AuthBootstrapTimeoutError extends Error {
  constructor() {
    super("Workspace initialization timed out.");
    this.name = "AuthBootstrapTimeoutError";
  }
}

export function classifyAuthBootstrapError(error: unknown): AuthBootstrapFailureKind {
  const details = typeof error === "object" && error !== null ? error as ErrorDetails : {};

  if (details.status === 401 || details.code === "AUTH_USER_MISMATCH") {
    return "unauthorized";
  }
  if (details.status === 403) {
    return "access-revoked";
  }
  return "recoverable";
}

export function getAuthBootstrapRetryDelay(attempt: number, failure: AuthBootstrapFailureKind) {
  if (failure !== "recoverable") {
    return null;
  }
  return AUTH_BOOTSTRAP_RETRY_DELAYS_MS[attempt] ?? null;
}

export function withAuthBootstrapTimeout<T>(promise: Promise<T>, timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => reject(new AuthBootstrapTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}
