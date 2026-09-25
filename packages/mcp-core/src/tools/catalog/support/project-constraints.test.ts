import { describe, expect, it } from "vitest";

import { UserInputError } from "../../../errors";
import {
  assertProjectConstraintEvidence,
  assertProjectListContainsConstraint,
  assertProjectRefWithinConstraint,
} from "./project-constraints";

describe("project constraint helpers", () => {
  describe("assertProjectRefWithinConstraint", () => {
    it("allows missing project evidence without a scoped project", () => {
      expect(() =>
        assertProjectRefWithinConstraint({
          resourceLabel: "Release",
          scopedProjectSlug: null,
          project: null,
        }),
      ).not.toThrow();
    });

    it("accepts a matching project slug", () => {
      expect(() =>
        assertProjectRefWithinConstraint({
          resourceLabel: "Release",
          scopedProjectSlug: "frontend",
          project: { slug: "frontend" },
        }),
      ).not.toThrow();
    });

    it("rejects a different project slug", () => {
      expect(() =>
        assertProjectRefWithinConstraint({
          resourceLabel: "Release",
          scopedProjectSlug: "frontend",
          project: { slug: "backend" },
        }),
      ).toThrow(UserInputError);
    });

    it("does not treat a display name as slug evidence", () => {
      const project = { slug: null, name: "frontend" };

      expect(() =>
        assertProjectRefWithinConstraint({
          resourceLabel: "Release",
          scopedProjectSlug: "frontend",
          project,
        }),
      ).toThrow(UserInputError);
    });
  });

  describe("assertProjectListContainsConstraint", () => {
    it("accepts a list containing the scoped project slug", () => {
      expect(() =>
        assertProjectListContainsConstraint({
          resourceLabel: "Release",
          scopedProjectSlug: "frontend",
          projects: [{ slug: "backend" }, { slug: "frontend" }],
        }),
      ).not.toThrow();
    });

    it("does not treat display names as slug evidence", () => {
      const projects = [{ slug: null, name: "frontend" }];

      expect(() =>
        assertProjectListContainsConstraint({
          resourceLabel: "Release",
          scopedProjectSlug: "frontend",
          projects,
        }),
      ).toThrow(UserInputError);
    });
  });

  describe("assertProjectConstraintEvidence", () => {
    it("allows missing evidence without a scoped project", () => {
      expect(() =>
        assertProjectConstraintEvidence({
          resourceLabel: "Release",
          scopedProjectSlug: null,
          hasEvidence: false,
        }),
      ).not.toThrow();
    });

    it("rejects missing evidence with a scoped project", () => {
      expect(() =>
        assertProjectConstraintEvidence({
          resourceLabel: "Release",
          scopedProjectSlug: "frontend",
          hasEvidence: false,
        }),
      ).toThrow(UserInputError);
    });
  });
});
