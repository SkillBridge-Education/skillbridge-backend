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
  },
});
