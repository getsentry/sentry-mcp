import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: spyOn requires object reference
import * as authModule from "../../../src/lib/db/auth.js";
import { WizardError } from "../../../src/lib/errors.js";
import { checkReadiness } from "../../../src/lib/init/readiness.js";
import type { WizardUI } from "../../../src/lib/init/ui/types.js";

function makeUI(): { ui: WizardUI; errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  const ui: WizardUI = {
    intro: () => {
      /* noop */
    },
    outro: () => {
      /* noop */
    },
    cancel: () => {
      /* noop */
    },
    feedback: () => {
      /* noop */
    },
    banner: () => {
      /* noop */
    },
    summary: () => {
      /* noop */
    },
    log: {
      info: () => {
        /* noop */
      },
      warn: (m) => warns.push(m),
      error: (m) => errors.push(m),
      success: () => {
        /* noop */
      },
      message: () => {
        /* noop */
      },
    },
    spinner: () => ({
      start: () => {
        /* noop */
      },
      message: () => {
        /* noop */
      },
      stop: () => {
        /* noop */
      },
    }),
    select: () => Promise.reject(new Error("noop")),
    multiselect: () => Promise.reject(new Error("noop")),
    confirm: () => Promise.reject(new Error("noop")),
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
  return { ui, errors, warns };
}

const OK_RESPONSE = new Response(null, { status: 200 });
const ERR_RESPONSE = new Response(null, { status: 503 });

let getAuthTokenSpy: ReturnType<typeof spyOn>;
let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  getAuthTokenSpy = vi.spyOn(authModule, "getAuthToken");
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  getAuthTokenSpy.mockRestore();
  fetchSpy.mockRestore();
});

describe("checkReadiness", () => {
  test("resolves without error when auth and API are both ok", async () => {
    getAuthTokenSpy.mockResolvedValue("tok_test");
    fetchSpy.mockResolvedValue(OK_RESPONSE.clone());
    const { ui, errors, warns } = makeUI();
    await expect(checkReadiness(ui)).resolves.toBeUndefined();
    expect(errors).toHaveLength(0);
    expect(warns).toHaveLength(0);
  });

  test("resolves but logs a warning when auth is ok and API is unreachable", async () => {
    getAuthTokenSpy.mockResolvedValue("tok_test");
    fetchSpy.mockRejectedValue(new Error("network failure"));
    const { ui, errors, warns } = makeUI();
    await expect(checkReadiness(ui)).resolves.toBeUndefined();
    expect(errors).toHaveLength(0);
    expect(warns.length).toBeGreaterThanOrEqual(1);
  });

  test("resolves but logs a warning when auth is ok and API returns non-ok status", async () => {
    getAuthTokenSpy.mockResolvedValue("tok_test");
    fetchSpy.mockResolvedValue(ERR_RESPONSE.clone());
    const { ui, errors, warns } = makeUI();
    await expect(checkReadiness(ui)).resolves.toBeUndefined();
    expect(errors).toHaveLength(0);
    expect(warns.length).toBeGreaterThanOrEqual(1);
  });

  test("throws WizardError when auth token is missing", async () => {
    getAuthTokenSpy.mockResolvedValue(undefined);
    fetchSpy.mockResolvedValue(OK_RESPONSE.clone());
    const { ui } = makeUI();
    await expect(checkReadiness(ui)).rejects.toThrow(WizardError);
    await expect(checkReadiness(ui)).rejects.toThrow("Not authenticated");
  });

  test("throws WizardError when both auth and API fail", async () => {
    getAuthTokenSpy.mockResolvedValue(undefined);
    fetchSpy.mockRejectedValue(new Error("network failure"));
    const { ui } = makeUI();
    await expect(checkReadiness(ui)).rejects.toThrow(WizardError);
    await expect(checkReadiness(ui)).rejects.toThrow(
      "Pre-flight checks failed"
    );
  });
});
