import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    // Integration tests share one Postgres connection pool (src/utils/prisma),
    // so they must run sequentially to avoid interleaved transactions.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/__tests__/**", "src/types/**"],
      // Set just under the current level so the suite can only improve.
      // Raise these as coverage grows rather than leaving them aspirational.
      thresholds: {
        statements: 54,
        branches: 37,
        functions: 51,
        lines: 56,
      },
    },
  },
});
