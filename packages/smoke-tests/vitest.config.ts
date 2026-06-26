import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000, // 30 seconds for network requests
    hookTimeout: 60000, // 60 seconds for setup/teardown
  },
});
