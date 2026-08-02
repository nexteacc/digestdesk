import { describe, expect, it, vi } from "vitest";
import {
  AuthBootstrapTimeoutError,
  classifyAuthBootstrapError,
  getAuthBootstrapRetryDelay,
  withAuthBootstrapTimeout,
} from "./auth-bootstrap";

describe("classifyAuthBootstrapError", () => {
  it("classifies unauthenticated and mismatched users as unauthorized", () => {
    expect(classifyAuthBootstrapError({ status: 401 })).toBe("unauthorized");
    expect(classifyAuthBootstrapError({ code: "AUTH_USER_MISMATCH" })).toBe("unauthorized");
  });

  it("classifies forbidden users as access revoked", () => {
    expect(classifyAuthBootstrapError({ status: 403 })).toBe("access-revoked");
  });

  it("classifies network and server failures as recoverable", () => {
    expect(classifyAuthBootstrapError({ status: 500 })).toBe("recoverable");
    expect(classifyAuthBootstrapError(new Error("offline"))).toBe("recoverable");
  });
});

describe("getAuthBootstrapRetryDelay", () => {
  it("allows two bounded retries for recoverable failures", () => {
    expect(getAuthBootstrapRetryDelay(0, "recoverable")).toBe(500);
    expect(getAuthBootstrapRetryDelay(1, "recoverable")).toBe(1_500);
    expect(getAuthBootstrapRetryDelay(2, "recoverable")).toBeNull();
  });

  it("does not retry authentication or access failures", () => {
    expect(getAuthBootstrapRetryDelay(0, "unauthorized")).toBeNull();
    expect(getAuthBootstrapRetryDelay(0, "access-revoked")).toBeNull();
  });
});

describe("withAuthBootstrapTimeout", () => {
  it("returns the underlying result when it completes in time", async () => {
    await expect(withAuthBootstrapTimeout(Promise.resolve("ready"), 10)).resolves.toBe("ready");
  });

  it("rejects stalled initialization with a timeout error", async () => {
    vi.useFakeTimers();
    const result = withAuthBootstrapTimeout(new Promise<never>(() => {}), 10);
    const expectation = expect(result).rejects.toBeInstanceOf(AuthBootstrapTimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    await expectation;
    vi.useRealTimers();
  });
});
