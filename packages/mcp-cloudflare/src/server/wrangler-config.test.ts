import prodConfig from "../../wrangler.jsonc?raw";
import canaryConfig from "../../wrangler.canary.jsonc?raw";
import testConfig from "../../wrangler.test.jsonc?raw";
import { describe, expect, it } from "vitest";

function parseWranglerConfig(config: string): {
  compatibility_flags?: unknown;
  secrets?: { required?: unknown };
  vars?: Record<string, unknown>;
} {
  return JSON.parse(
    config.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
  ) as {
    compatibility_flags?: unknown;
    secrets?: { required?: unknown };
    vars?: Record<string, unknown>;
  };
}

describe("wrangler configuration", () => {
  it.each([
    ["production", prodConfig],
    ["canary", canaryConfig],
    ["test", testConfig],
  ])("%s config keeps the CIMD SSRF protection flag", (_name, config) => {
    const parsed = parseWranglerConfig(config);

    expect(parsed.compatibility_flags).toEqual(
      expect.arrayContaining(["global_fetch_strictly_public"]),
    );
  });

  it.each([
    ["production", prodConfig],
    ["canary", canaryConfig],
  ])("%s config declares required local-dev secrets", (_name, config) => {
    const parsed = parseWranglerConfig(config);

    expect(parsed.secrets?.required).toEqual(
      expect.arrayContaining([
        "COOKIE_SECRET",
        "SENTRY_CLIENT_ID",
        "SENTRY_CLIENT_SECRET",
        "OPENAI_API_KEY",
      ]),
    );
  });

  it.each([
    ["production", prodConfig],
    ["canary", canaryConfig],
  ])("%s config does not hardcode deployable secret vars", (_name, config) => {
    const parsed = parseWranglerConfig(config);

    expect(parsed.vars).not.toHaveProperty("COOKIE_SECRET");
    expect(parsed.vars).not.toHaveProperty("SENTRY_CLIENT_ID");
    expect(parsed.vars).not.toHaveProperty("SENTRY_CLIENT_SECRET");
    expect(parsed.vars).not.toHaveProperty("OPENAI_API_KEY");
  });
});
