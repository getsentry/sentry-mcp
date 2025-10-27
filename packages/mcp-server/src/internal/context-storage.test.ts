import { describe, it, expect } from "vitest";
import { constraintsStorage, getConstraints } from "./context-storage";
import type { Constraints } from "../types";

describe("context-storage", () => {
  describe("constraintsStorage", () => {
    it("stores and retrieves constraints within async context", async () => {
      const testConstraints: Constraints = {
        organizationSlug: "test-org",
        projectSlug: "test-project",
        regionUrl: "https://us.sentry.io",
      };

      const result = await constraintsStorage.run(testConstraints, async () => {
        const stored = constraintsStorage.getStore();
        return stored;
      });

      expect(result).toEqual(testConstraints);
    });

    it("isolates constraints between concurrent async contexts", async () => {
      const constraints1: Constraints = {
        organizationSlug: "org1",
        projectSlug: "project1",
        regionUrl: "https://us.sentry.io",
      };

      const constraints2: Constraints = {
        organizationSlug: "org2",
        projectSlug: "project2",
        regionUrl: "https://eu.sentry.io",
      };

      // Run two contexts concurrently
      const [result1, result2] = await Promise.all([
        constraintsStorage.run(constraints1, async () => {
          // Simulate some async work
          await new Promise((resolve) => setTimeout(resolve, 10));
          return constraintsStorage.getStore();
        }),
        constraintsStorage.run(constraints2, async () => {
          // Simulate some async work
          await new Promise((resolve) => setTimeout(resolve, 5));
          return constraintsStorage.getStore();
        }),
      ]);

      // Each context should maintain its own constraints
      expect(result1).toEqual(constraints1);
      expect(result2).toEqual(constraints2);
    });

    it("maintains constraints through nested async operations", async () => {
      const testConstraints: Constraints = {
        organizationSlug: "nested-org",
        projectSlug: null,
        regionUrl: null,
      };

      const result = await constraintsStorage.run(testConstraints, async () => {
        // Nested async operations
        const level1 = await Promise.resolve().then(() =>
          constraintsStorage.getStore(),
        );

        const level2 = await (async () => {
          return constraintsStorage.getStore();
        })();

        const level3 = await new Promise((resolve) => {
          setTimeout(() => {
            resolve(constraintsStorage.getStore());
          }, 5);
        });

        return { level1, level2, level3 };
      });

      // All nested levels should have access to the same constraints
      expect(result.level1).toEqual(testConstraints);
      expect(result.level2).toEqual(testConstraints);
      expect(result.level3).toEqual(testConstraints);
    });

    it("returns undefined when accessed outside of context", () => {
      const stored = constraintsStorage.getStore();
      expect(stored).toBeUndefined();
    });

    it("allows nested contexts with different constraints", async () => {
      const outer: Constraints = {
        organizationSlug: "outer-org",
        projectSlug: null,
        regionUrl: null,
      };

      const inner: Constraints = {
        organizationSlug: "inner-org",
        projectSlug: "inner-project",
        regionUrl: "https://us.sentry.io",
      };

      const result = await constraintsStorage.run(outer, async () => {
        const outerValue = constraintsStorage.getStore();

        const innerValue = await constraintsStorage.run(inner, async () => {
          return constraintsStorage.getStore();
        });

        const backToOuter = constraintsStorage.getStore();

        return { outerValue, innerValue, backToOuter };
      });

      // Outer context before inner
      expect(result.outerValue).toEqual(outer);
      // Inner context
      expect(result.innerValue).toEqual(inner);
      // Back to outer context after inner completes
      expect(result.backToOuter).toEqual(outer);
    });
  });

  describe("getConstraints", () => {
    it("returns constraints when in async context", async () => {
      const testConstraints: Constraints = {
        organizationSlug: "helper-test",
        projectSlug: null,
        regionUrl: null,
      };

      const result = await constraintsStorage.run(testConstraints, async () => {
        return getConstraints();
      });

      expect(result).toEqual(testConstraints);
    });

    it("returns empty object when outside of context", () => {
      const result = getConstraints();
      expect(result).toEqual({});
    });

    it("handles partial constraints", async () => {
      const partialConstraints: Constraints = {
        organizationSlug: "test-org",
        projectSlug: null,
        regionUrl: null,
      };

      const result = await constraintsStorage.run(
        partialConstraints,
        async () => {
          return getConstraints();
        },
      );

      expect(result).toEqual(partialConstraints);
      expect(result.organizationSlug).toBe("test-org");
      expect(result.projectSlug).toBeNull();
      expect(result.regionUrl).toBeNull();
    });

    it("works correctly in multiple concurrent contexts", async () => {
      const results: Constraints[] = [];

      await Promise.all([
        constraintsStorage.run(
          { organizationSlug: "org1", projectSlug: null, regionUrl: null },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            results.push(getConstraints());
          },
        ),
        constraintsStorage.run(
          { organizationSlug: "org2", projectSlug: null, regionUrl: null },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            results.push(getConstraints());
          },
        ),
        constraintsStorage.run(
          { organizationSlug: "org3", projectSlug: null, regionUrl: null },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            results.push(getConstraints());
          },
        ),
      ]);

      // All three contexts should have their own constraints
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.organizationSlug).sort()).toEqual([
        "org1",
        "org2",
        "org3",
      ]);
    });
  });
});
