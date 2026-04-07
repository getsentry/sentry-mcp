import "./fetch-mock-hooks";
import { describe, expect, it } from "vitest";

function createEventsUrl(options?: {
  query?: string;
  sort?: string;
  fields?: string[];
}) {
  const url = new URL(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/events/",
  );
  url.searchParams.set("dataset", "errors");
  url.searchParams.set("sort", options?.sort ?? "-count");

  for (const field of options?.fields ?? [
    "issue",
    "title",
    "project",
    "last_seen()",
    "count()",
  ]) {
    url.searchParams.append("field", field);
  }

  if (options?.query !== undefined) {
    url.searchParams.set("query", options.query);
  }

  return url;
}

describe("fetchMock setup", () => {
  it("mirrors errors dataset validation from the shared MSW mocks", async () => {
    const validResponse = await fetch(
      createEventsUrl({
        query: "is:unresolved error.handled:false",
      }),
    );
    expect(validResponse.status).toBe(200);

    const invalidFieldsResponse = await fetch(
      createEventsUrl({
        fields: ["issue", "title", "project"],
      }),
    );
    expect(invalidFieldsResponse.status).toBe(400);

    const invalidSortResponse = await fetch(
      createEventsUrl({
        sort: "-timestamp",
      }),
    );
    expect(invalidSortResponse.status).toBe(400);
  });
});
