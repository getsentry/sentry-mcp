import type { Score } from "vitest-evals";

interface StructuredQueryExpectation {
  dataset?: string;
  query?: string | RegExp;
  fields?: string[] | ((fields: string[]) => boolean);
  sort?: string;
  timeRange?: any;
}

interface StructuredQueryResult {
  dataset?: string;
  query?: string;
  fields?: string[];
  sort?: string;
  timeRange?: any;
  error?: string;
}

export function StructuredQueryScorer(debug = false) {
  return async (opts: {
    input: string;
    expected: StructuredQueryExpectation;
    output: string;
  }): Promise<Score> => {
    try {
      const result: StructuredQueryResult = JSON.parse(opts.output);

      // If there's an error in the result, fail
      if (result.error) {
        return {
          score: 0,
          rationale: `Query generation failed with error: ${result.error}`,
        };
      }

      const failures: string[] = [];

      // Check dataset
      if (
        opts.expected.dataset !== undefined &&
        result.dataset !== opts.expected.dataset
      ) {
        failures.push(
          `Expected dataset '${opts.expected.dataset}' but got '${result.dataset}'`,
        );
      }

      // Check query
      if (opts.expected.query !== undefined) {
        if (opts.expected.query instanceof RegExp) {
          if (!opts.expected.query.test(result.query || "")) {
            failures.push(
              `Query '${result.query}' does not match pattern ${opts.expected.query}`,
            );
          }
        } else if (result.query !== opts.expected.query) {
          failures.push(
            `Expected query '${opts.expected.query}' but got '${result.query}'`,
          );
        }
      }

      // Check fields
      if (opts.expected.fields !== undefined) {
        if (typeof opts.expected.fields === "function") {
          if (!opts.expected.fields(result.fields || [])) {
            failures.push(
              `Fields validation function failed for: ${JSON.stringify(result.fields)}`,
            );
          }
        } else {
          const expectedFields = new Set(opts.expected.fields);
          const actualFields = new Set(result.fields || []);

          if (
            expectedFields.size !== actualFields.size ||
            ![...expectedFields].every((f) => actualFields.has(f))
          ) {
            failures.push(
              `Expected fields ${JSON.stringify(opts.expected.fields)} but got ${JSON.stringify(result.fields)}`,
            );
          }
        }
      }

      // Check sort
      if (
        opts.expected.sort !== undefined &&
        result.sort !== opts.expected.sort
      ) {
        failures.push(
          `Expected sort '${opts.expected.sort}' but got '${result.sort}'`,
        );
      }

      // Check timeRange
      if (opts.expected.timeRange !== undefined) {
        const expectedStr = JSON.stringify(opts.expected.timeRange);
        const actualStr = JSON.stringify(result.timeRange);
        if (expectedStr !== actualStr) {
          failures.push(
            `Expected timeRange ${expectedStr} but got ${actualStr}`,
          );
        }
      }

      if (debug && failures.length > 0) {
        console.log("Query validation failures:", failures);
        console.log("Actual result:", result);
      }

      return {
        score: failures.length === 0 ? 1 : 0,
        rationale:
          failures.length === 0
            ? "All query fields match expectations"
            : failures.join("; "),
      };
    } catch (error) {
      return {
        score: 0,
        rationale: `Failed to parse output as JSON: ${error}`,
      };
    }
  };
}
