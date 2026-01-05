import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["*.ts"],
      exclude: ["__tests__/**", "vitest.config.ts", "dist/**"],
    },
    testTimeout: 10000,
  },
});
