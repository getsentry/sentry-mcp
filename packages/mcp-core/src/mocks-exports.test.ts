import { describe, expect, it } from "vitest";
import { flamegraphFixture } from "@sentry/mcp-server-mocks";

describe("@sentry/mcp-server-mocks exports", () => {
  it("re-exports flamegraphFixture from the package entrypoint", () => {
    expect(flamegraphFixture).toBeDefined();
    expect(flamegraphFixture.projectID).toBe(4509062593708032);
    expect(flamegraphFixture.transactionName).toBe("/api/users");
  });
});
