import { describe, it, expect } from "vitest";
import { getEffectiveSubscriptionLimit, PLAN_LIMITS } from "./entitlements.js";
import type { userEntitlements } from "../db/schema.js";

type Entitlement = typeof userEntitlements.$inferSelect;

function makeEntitlement(partial: Partial<Entitlement>): Entitlement {
  return {
    userId: "u_test",
    accountPlan: "free",
    subscriptionLimitOverride: null,
    accessStatus: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: null,
    ...partial,
  };
}

describe("PLAN_LIMITS", () => {
  it("defines the expected per-plan caps", () => {
    expect(PLAN_LIMITS.free).toBe(100);
    expect(PLAN_LIMITS.test).toBe(300);
    expect(PLAN_LIMITS.admin).toBeNull();
  });
});

describe("getEffectiveSubscriptionLimit", () => {
  it("falls back to the plan default when there is no override", () => {
    expect(getEffectiveSubscriptionLimit(makeEntitlement({ accountPlan: "free" }))).toBe(100);
    expect(getEffectiveSubscriptionLimit(makeEntitlement({ accountPlan: "test" }))).toBe(300);
    expect(getEffectiveSubscriptionLimit(makeEntitlement({ accountPlan: "admin" }))).toBeNull();
  });

  it("prefers an explicit per-user override over the plan default", () => {
    expect(
      getEffectiveSubscriptionLimit(makeEntitlement({ accountPlan: "free", subscriptionLimitOverride: 5 })),
    ).toBe(5);
  });

  it("honors an override even for the unlimited admin plan", () => {
    expect(
      getEffectiveSubscriptionLimit(makeEntitlement({ accountPlan: "admin", subscriptionLimitOverride: 50 })),
    ).toBe(50);
  });
});
