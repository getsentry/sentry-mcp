import { describe, it, expect } from "vitest";
import {
  validateConstraints,
  applyConstraints,
  hasConstraints,
  hasOrganizationConstraint,
  hasProjectConstraint,
} from "./constraint-validation";
import { UserInputError } from "../errors";
import type { ServerContext } from "../types";

describe("constraint-validation", () => {
  describe("validateConstraints", () => {
    it("should allow all operations when no constraints exist", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
      };

      expect(() =>
        validateConstraints(
          { organizationSlug: "any-org", projectSlug: "any-project" },
          context,
        ),
      ).not.toThrow();
    });

    it("should allow matching organization", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
        },
      };

      expect(() =>
        validateConstraints({ organizationSlug: "acme-corp" }, context),
      ).not.toThrow();
    });

    it("should throw on organization mismatch", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
        },
      };

      expect(() =>
        validateConstraints({ organizationSlug: "other-org" }, context),
      ).toThrow(UserInputError);

      expect(() =>
        validateConstraints({ organizationSlug: "other-org" }, context),
      ).toThrow(/Organization constraint violation.*acme-corp.*other-org/);
    });

    it("should allow matching project", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
          projectSlug: "frontend",
        },
      };

      expect(() =>
        validateConstraints(
          { organizationSlug: "acme-corp", projectSlug: "frontend" },
          context,
        ),
      ).not.toThrow();
    });

    it("should throw on project mismatch", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
          projectSlug: "frontend",
        },
      };

      expect(() =>
        validateConstraints(
          { organizationSlug: "acme-corp", projectSlug: "backend" },
          context,
        ),
      ).toThrow(UserInputError);

      expect(() =>
        validateConstraints(
          { organizationSlug: "acme-corp", projectSlug: "backend" },
          context,
        ),
      ).toThrow(/Project constraint violation.*frontend.*backend/);
    });

    it("should validate projectSlugOrId parameter", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          projectSlug: "frontend",
        },
      };

      expect(() =>
        validateConstraints({ projectSlugOrId: "frontend" }, context),
      ).not.toThrow();

      expect(() =>
        validateConstraints({ projectSlugOrId: "backend" }, context),
      ).toThrow(/Project constraint violation.*frontend.*backend/);
    });

    it("should allow operations when parameters are not provided", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
          projectSlug: "frontend",
        },
      };

      // This is allowed - the tool might use context defaults
      expect(() => validateConstraints({}, context)).not.toThrow();
    });
  });

  describe("applyConstraints", () => {
    it("should return params unchanged when no constraints", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
      };

      const params = { organizationSlug: "test-org" };
      const result = applyConstraints(params, context);

      expect(result).toEqual(params);
    });

    it("should apply organization constraint when not provided", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
        },
      };

      const result = applyConstraints({}, context);

      expect(result).toHaveProperty("organizationSlug", "acme-corp");
    });

    it("should not override existing organization", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
        },
      };

      const result = applyConstraints(
        { organizationSlug: "other-org" },
        context,
      );

      expect(result.organizationSlug).toBe("other-org");
    });

    it("should apply project constraint to both fields", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          projectSlug: "frontend",
        },
      };

      const result = applyConstraints({}, context);

      expect(result).toHaveProperty("projectSlug", "frontend");
      expect(result).toHaveProperty("projectSlugOrId", "frontend");
    });

    it("should preserve other parameters", () => {
      const context: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: {
          organizationSlug: "acme-corp",
        },
      };

      interface ExtendedParams {
        organizationSlug?: string;
        customField: string;
      }

      const result = applyConstraints<ExtendedParams>(
        { customField: "value" },
        context,
      );

      expect(result.organizationSlug).toBe("acme-corp");
      expect(result.customField).toBe("value");
    });
  });

  describe("helper functions", () => {
    it("hasConstraints should detect constraints", () => {
      const withConstraints: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: { organizationSlug: "test" },
      };

      const withoutConstraints: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
      };

      expect(hasConstraints(withConstraints)).toBe(true);
      expect(hasConstraints(withoutConstraints)).toBe(false);
    });

    it("hasOrganizationConstraint should detect org constraint", () => {
      const withOrgConstraint: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: { organizationSlug: "test" },
      };

      const withProjectOnly: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: { projectSlug: "test" },
      };

      expect(hasOrganizationConstraint(withOrgConstraint)).toBe(true);
      expect(hasOrganizationConstraint(withProjectOnly)).toBe(false);
    });

    it("hasProjectConstraint should detect project constraint", () => {
      const withProjectConstraint: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: { projectSlug: "test" },
      };

      const withOrgOnly: ServerContext = {
        accessToken: "test-token",
        organizationSlug: null,
        constraints: { organizationSlug: "test" },
      };

      expect(hasProjectConstraint(withProjectConstraint)).toBe(true);
      expect(hasProjectConstraint(withOrgOnly)).toBe(false);
    });
  });
});
