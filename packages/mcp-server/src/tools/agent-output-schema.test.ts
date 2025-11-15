import { describe, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { searchEventsAgentOutputSchema } from "./search-events/agent";
import { searchIssuesAgentOutputSchema } from "./search-issues/agent";

describe("agent output schemas", () => {
  function expectRequiredFields(
    name: string,
    schema: ZodTypeAny,
    expected: string[],
  ) {
    const jsonSchema = zodToJsonSchema(schema, {
      $refStrategy: "none",
    }) as { required?: string[] };
    const required = jsonSchema.required ?? [];
    const missing = expected.filter((field) => !required.includes(field));
    const unexpected = required.filter((field) => !expected.includes(field));

    if (missing.length || unexpected.length) {
      throw new Error(
        `${name} schema mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}. Required fields: ${required.join(", ")}`,
      );
    }
  }

  it("marks all search_events fields as required", () => {
    expectRequiredFields("search_events", searchEventsAgentOutputSchema, [
      "dataset",
      "query",
      "fields",
      "sort",
      "timeRange",
      "explanation",
    ]);
  });

  it("marks all search_issues fields as required", () => {
    expectRequiredFields("search_issues", searchIssuesAgentOutputSchema, [
      "query",
      "sort",
      "explanation",
    ]);
  });
});
