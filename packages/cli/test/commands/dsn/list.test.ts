/** DSN listing contracts through the real command, SDK, and cursor storage. */

import { buildApplication, run } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { dsnRoute } from "../../../src/commands/dsn/index.js";
import { listCommand } from "../../../src/commands/dsn/list.js";
import type { SentryContext } from "../../../src/context.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import {
  setDefaultOrganization,
  setDefaultProject,
} from "../../../src/lib/db/defaults.js";
import { setOrgRegions } from "../../../src/lib/db/regions.js";
import { ApiError } from "../../../src/lib/errors.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

const configDir = useTestConfigDir("dsn-list-", { isolateProjectRoot: true });
const PUBLIC_DSN = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/42`;
const KEY = {
  id: "internal-key-id",
  projectId: 42,
  public: "standalone-public-key",
  secret: "private-key",
  useCase: "internal-purpose",
  name: "Browser",
  isActive: true,
  dateCreated: "2026-01-01T00:00:00Z",
  dsn: { public: PUBLIC_DSN, secret: "private-dsn", csp: "other-endpoint" },
};

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  setAuthToken("test-token");
  setOrgRegions([
    {
      slug: "test-org",
      regionUrl: "https://us.sentry.io",
      orgId: "1",
      orgName: "Test Org",
    },
  ]);
  setDefaultOrganization("test-org");
  setDefaultProject("test-project");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createContext() {
  let stdout = "";
  let stderr = "";
  const context: SentryContext = {
    configDir: configDir(),
    cwd: configDir(),
    env: process.env,
    homeDir: configDir(),
    process,
    stdin: process.stdin,
    stdout: {
      write: (value: string) => {
        stdout += value;
        return true;
      },
    },
    stderr: {
      write: (value: string) => {
        stderr += value;
        return true;
      },
    },
  };
  return { context, output: () => stdout, diagnostics: () => stderr };
}

function response(body: unknown, nextCursor?: string): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...(nextCursor
        ? {
            Link: `<https://us.sentry.io/api/0/>; rel="next"; results="true"; cursor="${nextCursor}"`,
          }
        : {}),
    },
  });
}

async function invoke(
  options: {
    target?: string;
    json?: boolean;
    limit?: number;
    cursor?: string;
  } = {}
) {
  const ctx = createContext();
  const func = await listCommand.loader();
  await func.call(
    ctx.context,
    {
      json: options.json ?? true,
      fresh: false,
      limit: options.limit ?? 25,
      cursor: options.cursor,
    },
    options.target
  );
  return ctx;
}

describe("dsn list", () => {
  test.each([
    "list",
    "ls",
  ])("%s exposes only user-facing fields in JSON", async (command) => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe("GET");
      expect(new URL(request.url).pathname).toBe(
        "/api/0/projects/test-org/test-project/keys/"
      );
      return response([KEY]);
    });
    const ctx = createContext();
    await run(
      buildApplication(dsnRoute, { name: "sentry dsn" }),
      [command, "test-org/test-project", "--json"],
      ctx.context
    );
    expect(JSON.parse(ctx.output())).toEqual({
      data: [
        {
          org: "test-org",
          project: "test-project",
          name: "Browser",
          isActive: true,
          dateCreated: KEY.dateCreated,
          dsn: PUBLIC_DSN,
        },
      ],
      hasMore: false,
      hasPrev: false,
    });
  });

  test("shows public DSNs, enabled status, and missing creation dates in human output", async () => {
    globalThis.fetch = mockFetch(async () =>
      response([
        KEY,
        { ...KEY, name: "Old browser", isActive: false, dateCreated: null },
      ])
    );
    const ctx = await invoke({ json: false, target: "test-org/test-project" });
    for (const visible of [
      "test-org/test-project",
      "Browser",
      "Enabled",
      "Disabled",
      "—",
      PUBLIC_DSN,
    ]) {
      expect(ctx.output()).toContain(visible);
    }
    expect(ctx.output()).not.toMatch(
      /internal-key-id|private-key|private-dsn|internal-purpose/
    );
  });

  test("uses configured project when the target is omitted", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      expect(new URL(new Request(input, init).url).pathname).toBe(
        "/api/0/projects/test-org/test-project/keys/"
      );
      return response([]);
    });
    const ctx = await invoke();
    expect(JSON.parse(ctx.output())).toEqual({
      data: [],
      hasMore: false,
      hasPrev: false,
    });
  });

  test("org/ lists keys from multiple projects using only public fields", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const path = new URL(new Request(input, init).url).pathname;
      if (path === "/api/0/organizations/test-org/project-keys/") {
        return response([KEY, { ...KEY, projectId: 43, isActive: false }]);
      }
      const projects: Record<string, string> = {
        "/api/0/projects/test-org/42/": "frontend",
        "/api/0/projects/test-org/43/": "backend",
      };
      expect(projects[path]).toBeDefined();
      return response({ slug: projects[path] });
    });
    const ctx = await invoke({ target: "test-org/" });
    expect(JSON.parse(ctx.output())).toEqual({
      data: [
        {
          org: "test-org",
          project: "frontend",
          name: KEY.name,
          dsn: PUBLIC_DSN,
          isActive: true,
          dateCreated: KEY.dateCreated,
        },
        {
          org: "test-org",
          project: "backend",
          name: KEY.name,
          dsn: PUBLIC_DSN,
          isActive: false,
          dateCreated: KEY.dateCreated,
        },
      ],
      hasMore: false,
      hasPrev: false,
    });
  });

  test("a bare name prefers the matching project over an organization", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const path = new URL(new Request(input, init).url).pathname;
      if (path === "/api/0/projects/test-org/test-org/") {
        return response({ id: "42", slug: "test-org", name: "Test Org" });
      }
      expect(path).toBe("/api/0/projects/test-org/test-org/keys/");
      return response([KEY]);
    });
    const result = JSON.parse((await invoke({ target: "test-org" })).output());
    expect(result.data).toMatchObject([
      { org: "test-org", project: "test-org", name: KEY.name },
    ]);
  });

  test("a bare org falls back to org listing with shared next/prev history", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.pathname === "/api/0/projects/test-org/test-org/") {
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.pathname === "/api/0/projects/test-org/42/") {
        return response({ slug: "frontend" });
      }
      expect(url.pathname).toBe("/api/0/organizations/test-org/project-keys/");
      expect(url.searchParams.get("per_page")).toBe("1");
      return url.searchParams.get("cursor") === "next:0:0"
        ? response([{ ...KEY, name: "Second" }])
        : response([KEY], "next:0:0");
    });
    const first = JSON.parse(
      (await invoke({ target: "test-org", limit: 1 })).output()
    );
    expect(first).toMatchObject({ hasMore: true, hasPrev: false });
    const next = JSON.parse(
      (await invoke({ target: "test-org/", limit: 1, cursor: "next" })).output()
    );
    expect(next).toMatchObject({
      data: [{ name: "Second", project: "frontend" }],
      hasMore: false,
      hasPrev: true,
    });
    const prev = JSON.parse(
      (await invoke({ target: "test-org", limit: 1, cursor: "prev" })).output()
    );
    expect(prev).toEqual(first);
    await expect(
      invoke({ target: "test-org/test-project", limit: 1, cursor: "next" })
    ).rejects.toThrow("No next page");
  });

  test("an empty organization returns an empty page without project lookups", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      expect(new URL(new Request(input, init).url).pathname).toBe(
        "/api/0/organizations/test-org/project-keys/"
      );
      return response([]);
    });
    expect(
      JSON.parse((await invoke({ target: "test-org/" })).output())
    ).toEqual({
      data: [],
      hasMore: false,
      hasPrev: false,
    });
  });

  test("explicit project wins over defaults and field selection stays inside the projection", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      expect(new URL(new Request(input, init).url).pathname).toBe(
        "/api/0/projects/test-org/other-project/keys/"
      );
      return response([KEY]);
    });
    const ctx = createContext();
    await run(
      buildApplication(dsnRoute, { name: "sentry dsn" }),
      [
        "list",
        "test-org/other-project",
        "--json",
        "--fields",
        "name,dsn,id,secret",
      ],
      ctx.context
    );
    expect(JSON.parse(ctx.output())).toEqual({
      data: [{ name: "Browser", dsn: PUBLIC_DSN }],
      hasMore: false,
      hasPrev: false,
    });
  });

  test("navigates forward and backward without losing keys", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      expect(url.searchParams.get("per_page")).toBe("1");
      return url.searchParams.get("cursor") === "next:0:0"
        ? response([{ ...KEY, name: "Second" }])
        : response([KEY], "next:0:0");
    });
    const first = JSON.parse((await invoke({ limit: 1 })).output());
    expect(first).toMatchObject({
      hasMore: true,
      hasPrev: false,
      nextCursor: "next:0:0",
    });
    const second = JSON.parse(
      (await invoke({ limit: 1, cursor: "next" })).output()
    );
    expect(second).toMatchObject({
      data: [{ name: "Second" }],
      hasMore: false,
      hasPrev: true,
    });
    const previous = JSON.parse(
      (await invoke({ limit: 1, cursor: "prev" })).output()
    );
    expect(previous).toEqual(first);
  });

  test("keeps pagination history scoped to project and page size", async () => {
    globalThis.fetch = mockFetch(async () => response([KEY], "next:0:0"));
    await invoke({ target: "test-org/test-project", limit: 1 });
    await expect(
      invoke({ target: "test-org/other-project", limit: 1, cursor: "next" })
    ).rejects.toThrow("No next page");
    await expect(
      invoke({ target: "test-org/test-project", limit: 2, cursor: "next" })
    ).rejects.toThrow("No next page");
  });

  test("surfaces denied access instead of presenting an empty list", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: "Permission denied" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
    );
    await expect(invoke({ target: "test-org/test-project" })).rejects.toThrow(
      ApiError
    );
  });
});
