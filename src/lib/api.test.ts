import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCurrentUserCache, ensureCurrentUser } from "./api";

function userResponse(clerkId: string) {
  return new Response(JSON.stringify({
    id: `db_${clerkId}`,
    clerkId,
    email: `${clerkId}@example.com`,
    name: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: "2026-01-01T00:00:00.000Z",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ensureCurrentUser", () => {
  beforeEach(() => {
    clearCurrentUserCache();
    vi.restoreAllMocks();
  });

  it("deduplicates initialization for the same Clerk user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(userResponse("user_a"));
    vi.stubGlobal("fetch", fetchMock);

    const first = ensureCurrentUser("user_a");
    const second = ensureCurrentUser("user_a");

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reuse cached initialization across Clerk users", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(userResponse("user_a"))
      .mockResolvedValueOnce(userResponse("user_b"));
    vi.stubGlobal("fetch", fetchMock);

    await ensureCurrentUser("user_a");
    await ensureCurrentUser("user_b");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a response that belongs to another Clerk user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(userResponse("user_a"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureCurrentUser("user_b")).rejects.toMatchObject({
      status: 401,
      code: "AUTH_USER_MISMATCH",
    });
  });

  it("clears failed initialization so it can be retried", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(userResponse("user_a"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureCurrentUser("user_a")).rejects.toThrow("offline");
    await expect(ensureCurrentUser("user_a")).resolves.toMatchObject({ clerkId: "user_a" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
