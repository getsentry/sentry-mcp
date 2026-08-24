import { describe, expect, test, vi } from "vitest";

const { assertHostedInitServiceAcceptsTokenHost, customFetch, refreshToken } =
  vi.hoisted(() => ({
    assertHostedInitServiceAcceptsTokenHost: vi.fn(),
    customFetch: vi.fn(),
    refreshToken: vi.fn(),
  }));

vi.mock("../../src/lib/custom-ca.js", () => ({ customFetch }));
vi.mock("../../src/lib/db/auth.js", () => ({ refreshToken }));
vi.mock("../../src/lib/init/init-service-auth.js", () => ({
  assertHostedInitServiceAcceptsTokenHost,
}));

import { queryDocs } from "../../src/lib/docs-service.js";
import { EXIT, isUserError } from "../../src/lib/errors.js";

describe("queryDocs", () => {
  test("explains when the service cannot verify a cited answer", async () => {
    refreshToken.mockResolvedValue({ token: "test-token" });
    customFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          code: "DOCS_UNGROUNDED",
          error: "Sentry documentation answer could not be verified",
        })
      ),
    });

    await expect(
      queryDocs("How do I configure tracing?", {
        frameworks: [],
        languages: [],
        sentryConfigured: false,
      })
    ).rejects.toMatchObject({
      exitCode: EXIT.API,
      message: expect.stringContaining(
        "Could not produce a verified documentation answer."
      ),
    });
  });

  test("treats an ungrounded answer as a user-facing failure", async () => {
    refreshToken.mockResolvedValue({ token: "test-token" });
    customFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          code: "DOCS_UNGROUNDED",
          error: "Sentry documentation answer could not be verified",
        })
      ),
    });

    const error = await queryDocs("How do I configure tracing?", {
      frameworks: [],
      languages: [],
      sentryConfigured: false,
    }).catch((caught: unknown) => caught);

    expect(isUserError(error)).toBe(true);
  });
});
