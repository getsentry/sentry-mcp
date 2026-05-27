import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import getLatestBaseSnapshot from "./get-latest-base-snapshot.js";
import { getServerContext } from "../test-setup.js";

const latestBaseFixture = {
  id: "232800",
  project_id: "12345",
  app_info: {
    app_id: "com.emergetools.hackernews",
    name: "HackerNews",
    platform: "ios",
  },
  vcs_info: {
    head_sha: "abc123def456",
    head_ref: "main",
  },
  images: [
    {
      display_name: "Home Screen",
      group: "Main",
      image_file_name: "snapshots-iphone/main_home_screen.png",
      description: "Home screen view",
    },
    {
      display_name: "Settings",
      group: "Settings",
      image_file_name: "snapshots-iphone/settings_page.png",
      description: "Settings page",
    },
  ],
};

describe("get_latest_base_snapshot", () => {
  it("returns curated markdown from latest base build", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/latest-base/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("app_id")).toBe(
            "com.emergetools.hackernews",
          );
          expect(url.searchParams.get("compact_metadata")).toBe("true");
          return HttpResponse.json(latestBaseFixture);
        },
        { once: true },
      ),
    );

    const result = await getLatestBaseSnapshot.handler(
      {
        organizationSlug: "sentry",
        appId: "com.emergetools.hackernews",
        branch: null,
        project: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;
    expect(text).toContain("# Latest Base Snapshot");
    expect(text).toContain("com.emergetools.hackernews");
    expect(text).toContain("**Snapshot ID**: 232800");
    expect(text).toContain("**Total Images**: 2");
    expect(text).toContain("main_home_screen.png — Home Screen — Main");
    expect(text).toContain("settings_page.png — Settings");
    expect(text).toContain("**App Name**: HackerNews");
    expect(text).toContain("**Platform**: ios");
    expect(text).toContain("**Branch**: main (`abc123de`)");
    expect(text).toContain("get_sentry_resource");
    expect(text).toMatchInlineSnapshot(`
      "# Latest Base Snapshot for **com.emergetools.hackernews** in **sentry**

      ## Summary

      - **URL**: https://sentry.sentry.io/preprod/snapshots/232800/
      - **Snapshot ID**: 232800
      - **App Name**: HackerNews
      - **Platform**: ios
      - **Branch**: main (\`abc123de\`)
      - **Total Images**: 2

      ## Images

      **Snapshot Images:**
      └── snapshots-iphone/
          ├── main_home_screen.png — Home Screen — Main
          └── settings_page.png — Settings

      ## Next Steps

      - To view a specific image, use \`get_sentry_resource(url="https://sentry.sentry.io/preprod/snapshots/232800/?selectedSnapshot=<image_file_name>")\`"
    `);
  });

  it("groups large latest-base image lists by shared path prefixes", async () => {
    const largeLatestBaseFixture = {
      ...latestBaseFixture,
      images: [
        {
          display_name: "Kenya",
          group: "FeaturedProductCard",
          image_file_name:
            "snapshots-iphone-17e/test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png",
        },
        {
          display_name: "Ethiopia",
          group: "FeaturedProductCard",
          image_file_name:
            "snapshots-iphone-17e/test_CoffeeProductCards.swift_FeaturedProductCard_Ethiopia.png",
        },
        {
          display_name: "Kenya",
          group: "FeaturedProductCard",
          image_file_name:
            "snapshots-iphone-17-pro-max/test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png",
        },
      ],
    };

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/latest-base/",
        () => HttpResponse.json(largeLatestBaseFixture),
        { once: true },
      ),
    );

    const result = await getLatestBaseSnapshot.handler(
      {
        organizationSlug: "sentry",
        appId: "com.emergetools.hackernews",
        branch: null,
        project: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;

    expect(text).toContain("**Total Images**: 3");
    expect(text).toContain("├── snapshots-iphone-17e/");
    expect(text).toContain("└── snapshots-iphone-17-pro-max/");
    expect(text).toContain(
      "test_CoffeeProductCards.swift_FeaturedProductCard_Ethiopia.png — Ethiopia — FeaturedProductCard",
    );
    expect(text).toContain(
      "test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png — Kenya — FeaturedProductCard",
    );
  });

  it("passes branch filter to endpoint", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/latest-base/",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("branch")).toBe("main");
          return HttpResponse.json(latestBaseFixture);
        },
        { once: true },
      ),
    );

    const result = await getLatestBaseSnapshot.handler(
      {
        organizationSlug: "sentry",
        appId: "com.emergetools.hackernews",
        branch: "main",
        project: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;
    expect(text).toContain("**Snapshot ID**: 232800");
  });

  it("handles empty images array", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/latest-base/",
        () =>
          HttpResponse.json({
            id: "232801",
            images: [],
            app_info: { app_id: "com.test.app", name: "Test" },
          }),
        { once: true },
      ),
    );

    const result = await getLatestBaseSnapshot.handler(
      {
        organizationSlug: "sentry",
        appId: "com.test.app",
        branch: null,
        project: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;
    expect(text).toContain("**Total Images**: 0");
    expect(text).not.toContain("## Images");
  });
});
