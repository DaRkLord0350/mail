import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "./src") };

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // Integration files share one database: never run test files in parallel.
    fileParallelism: false,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Remote Postgres (~150ms RTT): serial files, generous timeouts.
          maxConcurrency: 1,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 120_000,
          hookTimeout: 300_000,
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/env.ts", "tests/integration/setup.ts"],
        },
      },
    ],
  },
});
