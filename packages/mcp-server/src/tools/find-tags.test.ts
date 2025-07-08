import { describe, it, expect } from "vitest";
import findTags from "./find-tags.js";

describe("find_tags", () => {
  it("works", async () => {
    const result = await findTags.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: undefined,
      },
      {
        accessToken: "access-token",
        userId: "1",
        organizationSlug: null,
      },
    );
    expect(result).toMatchInlineSnapshot(`
      "# Tags in **sentry-mcp-evals**

      - transaction
      - runtime.name
      - level
      - device
      - os
      - user
      - runtime
      - release
      - url
      - uptime_rule
      - server_name
      - browser
      - os.name
      - device.family
      - replayId
      - client_os.name
      - environment
      - service
      - browser.name

      # Using this information

      - You can reference tags in the \`query\` parameter of various tools: \`tagName:tagValue\`.
      "
    `);
  });
});
