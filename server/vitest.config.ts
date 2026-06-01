import { defineConfig } from "vitest/config";

/**
 * Server-only test config. Defined explicitly so vitest does not walk up to the
 * repo-root `vite.config.ts` (which carries the React/Tailwind frontend plugins).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
