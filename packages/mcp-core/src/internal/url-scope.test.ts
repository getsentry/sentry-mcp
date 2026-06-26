import { describe, expect, it } from "vitest";
import { resolveScopedProjectSlugOrId } from "./url-scope.js";

describe("resolveScopedProjectSlugOrId", () => {
  it("prefers the URL slug when the scoped project is a numeric string", () => {
    expect(
      resolveScopedProjectSlugOrId({
        resourceLabel: "Profile",
        scopedProjectSlugOrId: "4509109104082945",
        urlProjectSlug: "cloudflare-mcp",
      }),
    ).toBe("cloudflare-mcp");
  });

  it("prefers the URL slug when the scoped project is a numeric ID", () => {
    expect(
      resolveScopedProjectSlugOrId({
        resourceLabel: "Profile",
        scopedProjectSlugOrId: 4509109104082945,
        urlProjectSlug: "cloudflare-mcp",
      }),
    ).toBe("cloudflare-mcp");
  });

  it("rejects mismatched slug constraints", () => {
    expect(() =>
      resolveScopedProjectSlugOrId({
        resourceLabel: "Profile",
        scopedProjectSlugOrId: "frontend",
        urlProjectSlug: "cloudflare-mcp",
      }),
    ).toThrow(
      'Profile URL is outside the active project constraint. Expected project "frontend" but got "cloudflare-mcp".',
    );
  });
});
