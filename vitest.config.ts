import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    coverage: {
      enabled: false
    },
    sequence: {
      concurrent: false
    },
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  }
});
