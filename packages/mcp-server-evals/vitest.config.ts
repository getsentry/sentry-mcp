/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import { resolve } from "node:path";

// Load .env from project root
config({ path: resolve(__dirname, "../../.env") });

export default defineConfig({
  test: {
    include: ["**/*.eval.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["vitest-evals/reporter"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["**/*.ts"],
    },
  },
});
