/** Tests for listing public DSNs through the API SDK. */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  listOrganizationDsns,
  listProjectDsns,
} from "../../../src/lib/api/projects.js";
import { setAuthToken } from "../../../src/lib/db/auth.js";
import { setOrgRegion } from "../../../src/lib/db/regions.js";
import { ApiError } from "../../../src/lib/errors.js";
import { mockFetch, useTestConfigDir } from "../../helpers.js";

useTestConfigDir("project-dsns-api-test-");

const PUBLIC_DSN = "https://public-key@o1.ingest.de.sentry.io/42";

/** Include raw API fields that must never escape the user-facing projection. */
function projectKey(index = 0) {
  return {
    id: `internal-key-${index}`,
    name: `Key ${index}`,
    label: `Key ${index}`,
    isActive: true,
    dateCreated: "2026-01-01T00:00:00Z",
    projectId: 42,
    public: "public-key",
    secret: "legacy-secret",
    dsn: {
      public: PUBLIC_DSN,
      secret: "https://public-key:legacy-secret@o1.ingest.de.sentry.io/42",
      csp: "https://o1.ingest.de.sentry.io/api/42/csp-report/",
    },
    rateLimit: { count: 100, window: 60 },
    browserSdkVersion: "latest",
    dynamicSdkLoaderOptions: { hasReplay: true },
    useCase: "internal",
    unexpectedPrivateField: "must-not-be-exposed",
  };
}

function keysResponse(body: unknown, nextCursor?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(nextCursor
        ? {
            Link: `<https://de.sentry.io/api/0/next/>; rel="next"; results="true"; cursor="${nextCursor}"`,
          }
        : {}),
    },
  });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  await setAuthToken("test-token");
  setOrgRegion("test-org", "https://de.sentry.io");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listProjectDsns", () => {
  test("uses the organization's region and shared pagination default", async () => {
    let capturedRequest: Request | undefined;
    globalThis.fetch = mockFetch(async (input, init) => {
      capturedRequest = new Request(input!, init);
      return keysResponse([]);
    });

    const result = await listProjectDsns("test-org", "frontend");

    expect(capturedRequest?.method).toBe("GET");
    expect(capturedRequest?.url).toBe(
      "https://de.sentry.io/api/0/projects/test-org/frontend/keys/?per_page=10"
    );
    expect(capturedRequest?.headers.get("Authorization")).toBe(
      "Bearer test-token"
    );
    expect(result).toEqual({ data: [] });
  });

  test("exposes only public fields, including inactive keys and nullable dates", async () => {
    globalThis.fetch = mockFetch(async () =>
      keysResponse([
        projectKey(),
        { ...projectKey(1), isActive: false, dateCreated: null },
      ])
    );

    const result = await listProjectDsns("test-org", "frontend");

    expect(result.data).toEqual([
      {
        name: "Key 0",
        isActive: true,
        dateCreated: "2026-01-01T00:00:00Z",
        dsn: PUBLIC_DSN,
      },
      {
        name: "Key 1",
        isActive: false,
        dateCreated: null,
        dsn: PUBLIC_DSN,
      },
    ]);
  });

  test("passes a custom limit and starting cursor, preserving the next cursor", async () => {
    let capturedUrl = "";
    globalThis.fetch = mockFetch(async (input, init) => {
      capturedUrl = new Request(input!, init).url;
      return keysResponse([projectKey()], "0:75:0");
    });

    const result = await listProjectDsns("test-org", "frontend", {
      limit: 50,
      cursor: "0:25:0",
    });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("cursor")).toBe("0:25:0");
    expect(url.searchParams.has("status")).toBe(false);
    expect(result.nextCursor).toBe("0:75:0");
  });

  test("bounds every page to the remaining budget and resumes without skipping keys", async () => {
    const requests: URL[] = [];
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input!, init).url);
      requests.push(url);
      const offset = Number(url.searchParams.get("cursor")?.split(":")[1] ?? 0);
      const perPage = Number(url.searchParams.get("per_page"));
      const remaining = 175 - offset;
      const count = Math.min(perPage, remaining);
      return keysResponse(
        Array.from({ length: count }, (_, index) => projectKey(offset + index)),
        count < remaining ? `0:${offset + count}:0` : undefined
      );
    });

    const first = await listProjectDsns("test-org", "frontend", {
      limit: 150,
    });
    const second = await listProjectDsns("test-org", "frontend", {
      limit: 50,
      cursor: first.nextCursor,
    });

    expect(requests.map((url) => url.searchParams.get("per_page"))).toEqual([
      "100",
      "50",
      "50",
    ]);
    expect(requests.map((url) => url.searchParams.get("cursor"))).toEqual([
      null,
      "0:100:0",
      "0:150:0",
    ]);
    expect(first.data).toHaveLength(150);
    expect(first.nextCursor).toBe("0:150:0");
    expect(second.nextCursor).toBeUndefined();
    expect([...first.data, ...second.data].map((key) => key.name)).toEqual(
      Array.from({ length: 175 }, (_, index) => `Key ${index}`)
    );
  });
});

describe("listOrganizationDsns", () => {
  test("requests all accessible projects in the organization's region", async () => {
    const requests: Request[] = [];
    globalThis.fetch = mockFetch(async (input, init) => {
      requests.push(new Request(input!, init));
      return keysResponse([]);
    });

    expect(await listOrganizationDsns("test-org")).toEqual({ data: [] });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const url = new URL(request.url);
    expect(request.method).toBe("GET");
    expect(request.headers.get("Authorization")).toBe("Bearer test-token");
    expect(url.origin).toBe("https://de.sentry.io");
    expect(url.pathname).toBe("/api/0/organizations/test-org/project-keys/");
    expect(url.searchParams.get("project")).toBe("-1");
    expect(url.searchParams.get("per_page")).toBe("10");
    expect(url.searchParams.has("status")).toBe(false);
  });

  test("resolves each project once and returns only public fields and slugs", async () => {
    const paths: string[] = [];
    const otherDsn = "https://other-key@o1.ingest.de.sentry.io/7";
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input!, init).url);
      paths.push(url.pathname);
      switch (url.pathname) {
        case "/api/0/organizations/test-org/project-keys/":
          return keysResponse([
            projectKey(),
            { ...projectKey(1), isActive: false, dateCreated: null },
            {
              ...projectKey(2),
              projectId: 7,
              dsn: { ...projectKey().dsn, public: otherDsn },
            },
          ]);
        case "/api/0/projects/test-org/42/":
          return keysResponse({ id: "42", slug: "frontend", name: "Frontend" });
        case "/api/0/projects/test-org/7/":
          return keysResponse({ id: "7", slug: "backend", name: "Backend" });
        default:
          throw new Error(`Unexpected request: ${url.pathname}`);
      }
    });

    const result = await listOrganizationDsns("test-org");

    expect(result.data).toEqual([
      {
        name: "Key 0",
        isActive: true,
        dateCreated: "2026-01-01T00:00:00Z",
        dsn: PUBLIC_DSN,
        project: "frontend",
      },
      {
        name: "Key 1",
        isActive: false,
        dateCreated: null,
        dsn: PUBLIC_DSN,
        project: "frontend",
      },
      {
        name: "Key 2",
        isActive: true,
        dateCreated: "2026-01-01T00:00:00Z",
        dsn: otherDsn,
        project: "backend",
      },
    ]);
    expect(paths.sort()).toEqual([
      "/api/0/organizations/test-org/project-keys/",
      "/api/0/projects/test-org/42/",
      "/api/0/projects/test-org/7/",
    ]);
  });

  test("paginates and resumes org keys without repeating project lookups across pages", async () => {
    const keyRequests: URL[] = [];
    let projectRequests = 0;
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input!, init).url);
      if (url.pathname === "/api/0/projects/test-org/42/") {
        projectRequests += 1;
        return keysResponse({ id: "42", slug: "frontend", name: "Frontend" });
      }
      expect(url.pathname).toBe("/api/0/organizations/test-org/project-keys/");
      expect(url.searchParams.get("project")).toBe("-1");
      keyRequests.push(url);
      const offset = Number(url.searchParams.get("cursor")?.split(":")[1] ?? 0);
      const perPage = Number(url.searchParams.get("per_page"));
      const count = Math.min(perPage, 175 - offset);
      return keysResponse(
        Array.from({ length: count }, (_, index) => projectKey(offset + index)),
        offset + count < 175 ? `0:${offset + count}:0` : undefined
      );
    });

    const first = await listOrganizationDsns("test-org", { limit: 150 });
    expect(projectRequests).toBe(1);
    expect(first.nextCursor).toBe("0:150:0");
    const second = await listOrganizationDsns("test-org", {
      limit: 50,
      cursor: first.nextCursor,
    });

    expect(keyRequests.map((url) => url.searchParams.get("per_page"))).toEqual([
      "100",
      "50",
      "50",
    ]);
    expect(keyRequests.map((url) => url.searchParams.get("cursor"))).toEqual([
      null,
      "0:100:0",
      "0:150:0",
    ]);
    expect(first.data).toHaveLength(150);
    expect(second.data).toHaveLength(25);
    expect(second.nextCursor).toBeUndefined();
    expect([...first.data, ...second.data].map((key) => key.name)).toEqual(
      Array.from({ length: 175 }, (_, index) => `Key ${index}`)
    );
  });

  test("surfaces project lookup failures instead of dropping keys or exposing IDs", async () => {
    globalThis.fetch = mockFetch(async (input, init) => {
      const url = new URL(new Request(input!, init).url);
      if (url.pathname === "/api/0/organizations/test-org/project-keys/") {
        return keysResponse([projectKey()]);
      }
      expect(url.pathname).toBe("/api/0/projects/test-org/42/");
      return new Response(JSON.stringify({ detail: "Permission denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(listOrganizationDsns("test-org")).rejects.toBeInstanceOf(
      ApiError
    );
  });
});
