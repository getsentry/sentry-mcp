import { describe, expect, it } from "vitest";
import {
  extractIssueId,
  parseIssueId,
  parseIssueParams,
} from "./issue-helpers";

describe("extractIssueId", () => {
  it("should extract issue ID from a full Sentry URL", () => {
    expect(
      extractIssueId("https://sentry.sentry.io/issues/1234"),
    ).toMatchInlineSnapshot(`
      {
        "issueId": "1234",
        "organizationSlug": "sentry",
      }
    `);
  });

  it("should extract issue ID from a Sentry URL with organization in path", () => {
    expect(
      extractIssueId("https://sentry.io/sentry/issues/123"),
    ).toMatchInlineSnapshot(`
      {
        "issueId": "123",
        "organizationSlug": "sentry",
      }
    `);
  });

  it("should extract issue ID and org slug from URL with organizations path", () => {
    expect(
      extractIssueId("https://sentry.io/organizations/my-org/issues/123"),
    ).toMatchInlineSnapshot(`
      {
        "issueId": "123",
        "organizationSlug": "my-org",
      }
    `);
  });

  it("should extract issue ID and org slug from subdomain URL", () => {
    expect(extractIssueId("https://my-team.sentry.io/issues/123")).toEqual({
      issueId: "123",
      organizationSlug: "my-team",
    });
  });

  it("should extract issue ID and org slug from self-hosted Sentry with subdomain", () => {
    expect(
      extractIssueId("https://sentry.mycompany.com/issues/123"),
    ).toMatchInlineSnapshot(`
      {
        "issueId": "123",
        "organizationSlug": "sentry",
      }
    `);
  });

  it("should extract issue ID and org slug from self-hosted Sentry with organization path", () => {
    expect(
      extractIssueId("https://mycompany.com/my-team/issues/123"),
    ).toMatchInlineSnapshot(`
      {
        "issueId": "123",
        "organizationSlug": "my-team",
      }
    `);
  });

  it("should throw error for empty input", () => {
    expect(() => extractIssueId("")).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid Sentry issue URL. URL must be a non-empty string.]`,
    );
  });

  it("should throw error for invalid URL path", () => {
    expect(() =>
      extractIssueId("https://sentry.sentry.io/projects/123"),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid Sentry issue URL. Path must contain '/issues/{issue_id}']`,
    );
  });

  it("should throw error for non-numeric issue ID in URL", () => {
    expect(
      extractIssueId("https://sentry.sentry.io/issues/abc"),
    ).toMatchInlineSnapshot(`
      {
        "issueId": "abc",
        "organizationSlug": "sentry",
      }
    `);
  });

  it("should throw error for non-numeric standalone ID", () => {
    expect(() => extractIssueId("abc")).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid Sentry issue URL. Must start with http:// or https://]`,
    );
  });
});

describe("parseIssueId", () => {
  it("should remove trailing punctuation from issue ID", () => {
    expect(
      // trailing period and exclamation
      parseIssueId("CLOUDFLARE-MCP-41.!"),
    ).toBe("CLOUDFLARE-MCP-41");
  });

  it("should not modify a clean issue ID", () => {
    expect(parseIssueId("CLOUDFLARE-MCP-41")).toBe("CLOUDFLARE-MCP-41");
  });

  it("should remove special characters except dash and underscore", () => {
    expect(parseIssueId("ID_123-456!@#")).toBe("ID_123-456");
  });
});

describe("parseIssueParams", () => {
  it("should parse from issueUrl", () => {
    expect(
      parseIssueParams({
        issueUrl: "https://sentry.io/sentry/issues/123",
      }),
    ).toEqual({ organizationSlug: "sentry", issueId: "123" });
  });

  it("should parse from issueId and organizationSlug", () => {
    expect(
      parseIssueParams({
        issueId: "CLOUDFLARE-MCP-41.!",
        organizationSlug: "sentry-mcp-evals",
      }),
    ).toEqual({
      organizationSlug: "sentry-mcp-evals",
      issueId: "CLOUDFLARE-MCP-41",
    });
  });

  it("should throw if neither issueId nor issueUrl is provided", () => {
    expect(() =>
      parseIssueParams({ organizationSlug: "foo" }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Either issueId or issueUrl must be provided]`,
    );
  });

  it("should throw if organizationSlug is missing and no issueUrl", () => {
    expect(() =>
      parseIssueParams({ issueId: "123" }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Organization slug is required]`,
    );
  });

  it("should throw if issueUrl is invalid", () => {
    expect(() =>
      parseIssueParams({ issueUrl: "not-a-url" }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid Sentry issue URL. Must start with http:// or https://]`,
    );
  });
});
