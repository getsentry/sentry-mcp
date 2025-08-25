import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/simple-oauth.ts"],
      exclude: [
        "**/*.test.ts", 
        "**/*.spec.ts", 
        "__tests__/**",
        "src/oauth-provider.ts",
        "src/policy-enforcement.ts",
        "src/simple-oauth-v2.ts",
        "src/index.ts"
      ],
    },
  },
});