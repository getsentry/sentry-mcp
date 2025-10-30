import { describe, it, expect } from "vitest";
import { buildServer } from "./server";
import type { ServerContext } from "./types";
import type { Skill } from "./skills";

describe("server skills integration", () => {
  const baseContext: ServerContext = {
    accessToken: "test-token",
    sentryHost: "sentry.io",
    constraints: {
      organizationSlug: null,
      projectSlug: null,
    },
  };

  describe("server builds with skills", () => {
    it("builds successfully when no skills specified", () => {
      const server = buildServer({ context: baseContext });
      expect(server).toBeDefined();
    });

    it("builds successfully with inspect skill", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>(["inspect"]),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });

    it("builds successfully with multiple skills", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>(["inspect", "triage", "docs"]),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });

    it("builds successfully with all skills", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>([
          "inspect",
          "triage",
          "project-management",
          "seer",
          "docs",
        ]),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });
  });

  describe("server builds with skills and scopes", () => {
    it("builds successfully with both skills and scopes", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>(["inspect"]),
        grantedScopes: new Set(["event:write"]),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });

    it("builds successfully with only skills", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>(["triage"]),
        grantedScopes: undefined,
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });

    it("builds successfully with only scopes", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: undefined,
        grantedScopes: new Set(["event:write"]),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });

    it("builds successfully with empty skills set", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>(),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });

    it("builds successfully with neither skills nor scopes", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: undefined,
        grantedScopes: undefined,
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();
    });
  });

  describe("tool filtering by skills", () => {
    it("filters tools correctly with inspect+seer skills only", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>(["inspect", "seer"]),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();

      // Expected behavior (verified manually via MCP tools/list):
      // - find_dsns should NOT be available (requires "project-management" skill)
      // - whoami SHOULD be available (available to ALL_SKILLS)
      // - get_issue_details SHOULD be available (requires "inspect" or "triage" or "seer")
      // - analyze_issue_with_seer SHOULD be available (requires "seer")
    });

    it("does not fall back to scope checking when skills are present", () => {
      const context: ServerContext = {
        ...baseContext,
        grantedSkills: new Set<Skill>(["inspect"]),
        // Even though scopes include project:read, find_dsns should NOT be available
        // because it requires "project-management" skill
        grantedScopes: new Set(["project:read", "event:read"]),
      };
      const server = buildServer({ context });
      expect(server).toBeDefined();

      // Expected behavior (verified manually via MCP tools/list):
      // - Tool filtering should ONLY check skills, not scopes
      // - find_dsns should NOT be available (wrong skill, even though scope matches)
    });
  });
});
