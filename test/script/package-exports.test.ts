import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import pkg from "../../package.json";

/**
 * Guards the dual-package (ESM + CJS) contract of the published `sentry`
 * library. The bundler-plugin SDK and other ESM consumers import the default
 * export; a regression to a CJS-only `exports` map silently breaks them
 * (`createSentrySDK is not a function`) even though unit tests still pass.
 */
describe("package.json exports (dual ESM/CJS)", () => {
  const root = new URL("../../", import.meta.url);
  const resolve = (rel: string) => fileURLToPath(new URL(rel, root));

  test("declares both import and require conditions with matching types", () => {
    const dot = pkg.exports["."] as {
      import?: { types?: string; default?: string };
      require?: { types?: string; default?: string };
    };

    expect(dot.import?.default).toBe("./dist/index.mjs");
    expect(dot.import?.types).toBe("./dist/index.d.mts");
    expect(dot.require?.default).toBe("./dist/index.cjs");
    expect(dot.require?.types).toBe("./dist/index.d.cts");
  });

  test("ships both bundles and their type declarations in files", () => {
    for (const f of [
      "dist/index.mjs",
      "dist/index.cjs",
      "dist/index.d.mts",
      "dist/index.d.cts",
    ]) {
      expect(pkg.files).toContain(f);
    }
  });

  // Only meaningful after a build; skipped in a clean checkout where dist/ is absent.
  const built = existsSync(resolve("dist/index.mjs"));
  test.runIf(built)("built ESM entry exposes createSentrySDK", async () => {
    const mod = await import(resolve("dist/index.mjs"));
    expect(typeof mod.default).toBe("function");
    expect(typeof mod.createSentrySDK).toBe("function");
  });

  test.runIf(built)("built CJS entry exposes createSentrySDK", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(resolve("dist/index.cjs"));
    expect(typeof mod.createSentrySDK).toBe("function");
    expect(typeof mod.default).toBe("function");
  });
});
