import { describe, expect, it, vi } from "vitest";
import type { SetActive } from "@clerk/react";
import {
  AUTH_SESSION_TASK_ROUTES,
  finalizeAuthSession,
  getAuthSessionRoute,
  getAuthSessionUrl,
  getLocalAuthRoute,
} from "./auth-session";

describe("auth session destinations", () => {
  it("sends a completed session to the workspace", () => {
    expect(getAuthSessionRoute()).toBe("/");
    expect(getAuthSessionUrl()).toBe("/#/");
  });

  it.each(Object.entries(AUTH_SESSION_TASK_ROUTES))(
    "routes the %s task to its Clerk task page",
    (key, route) => {
      expect(getAuthSessionRoute({ key } as Parameters<typeof getAuthSessionRoute>[0])).toBe(route);
      expect(getAuthSessionUrl({ key } as Parameters<typeof getAuthSessionUrl>[0])).toBe(`/#${route}`);
    },
  );

  it("extracts a local hash route without losing its query", () => {
    expect(getLocalAuthRoute("/#/session-task/setup-mfa?source=email", "/")).toBe(
      "/session-task/setup-mfa?source=email",
    );
    expect(getLocalAuthRoute("/", "/session-task/reset-password")).toBe("/session-task/reset-password");
  });
});

describe("finalizeAuthSession", () => {
  it("activates the session and navigates to the workspace", async () => {
    const navigate = vi.fn();
    const setActive = vi.fn(async ({ navigate: clerkNavigate }) => {
      await clerkNavigate?.({
        session: { currentTask: undefined },
        decorateUrl: (url: string) => url,
      } as never);
    }) as unknown as SetActive;

    await finalizeAuthSession({ setActive, sessionId: "session_1", navigate });

    expect(setActive).toHaveBeenCalledWith(expect.objectContaining({ session: "session_1" }));
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("hands a pending session to the matching task page", async () => {
    const navigate = vi.fn();
    const setActive = vi.fn(async ({ navigate: clerkNavigate }) => {
      await clerkNavigate?.({
        session: { currentTask: { key: "reset-password" } },
        decorateUrl: (url: string) => url,
      } as never);
    }) as unknown as SetActive;

    await finalizeAuthSession({ setActive, sessionId: "session_2", navigate });

    expect(navigate).toHaveBeenCalledWith("/session-task/reset-password");
  });

  it("uses Clerk's external decorated URL when cookie refresh is required", async () => {
    const navigate = vi.fn();
    const navigateExternal = vi.fn();
    const setActive = vi.fn(async ({ navigate: clerkNavigate }) => {
      await clerkNavigate?.({
        session: { currentTask: undefined },
        decorateUrl: () => "https://accounts.example.com/refresh",
      } as never);
    }) as unknown as SetActive;

    await finalizeAuthSession({
      setActive,
      sessionId: "session_3",
      navigate,
      navigateExternal,
    });

    expect(navigateExternal).toHaveBeenCalledWith("https://accounts.example.com/refresh");
    expect(navigate).not.toHaveBeenCalled();
  });
});
