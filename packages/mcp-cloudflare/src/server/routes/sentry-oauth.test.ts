import { describe, it, expect } from "vitest";
import type { Scope } from "@sentry/mcp-server/permissions";

// Import only the function under test via module path
import * as oauthModule from "./sentry-oauth";

// Narrow access to the internal function via any to avoid exporting it
const getScopesFromPermissions = (oauthModule as any)
  .getScopesFromPermissions as (p?: unknown) => Set<Scope>;

describe("getScopesFromPermissions", () => {
  it("returns base scopes for invalid types", () => {
    const cases: unknown[] = [undefined, null, 123, { a: 1 }, true];
    for (const c of cases) {
      const scopes = getScopesFromPermissions(c);
      expect(scopes.has("org:read")).toBe(true);
      expect(scopes.has("project:read")).toBe(true);
      expect(scopes.has("team:read")).toBe(true);
      expect(scopes.has("event:read")).toBe(true);
      expect(scopes.has("event:write")).toBe(false);
      expect(scopes.has("project:write")).toBe(false);
    }
  });

  it("adds write scopes when valid permissions present", () => {
    const scopes1 = getScopesFromPermissions(["issue_triage"]);
    expect(scopes1.has("event:write")).toBe(true);

    const scopes2 = getScopesFromPermissions(["project_management"]);
    expect(scopes2.has("project:write")).toBe(true);
    expect(scopes2.has("team:write")).toBe(true);
  });
});
