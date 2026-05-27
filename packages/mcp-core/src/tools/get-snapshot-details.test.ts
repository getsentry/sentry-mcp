import { describe, it, expect } from "vitest";
import { decode as decodePng, encode as encodePng } from "fast-png";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import getSnapshotDetails from "./get-snapshot-details.js";
import { getServerContext } from "../test-setup.js";
import type {
  ImageContent,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";

const snapshotFixture = {
  head_artifact_id: "231949",
  base_artifact_id: "231900",
  project_id: "12345",
  comparison_type: "diff",
  state: "visible",
  vcs_info: {
    head_sha: "abc123def",
    base_sha: "000111222",
    head_ref: "feature/new-login",
    base_ref: "main",
    pr_number: "789",
    provider: "github",
    repo_name: "getsentry/sentry",
  },
  changed_count: 2,
  added_count: 1,
  removed_count: 0,
  renamed_count: 1,
  unchanged_count: 10,
  errored_count: 0,
  skipped_count: 0,
  approval_info: {
    status: "requires_approval",
    is_auto_approved: false,
    approvers: [],
  },
  comparison_run_info: {
    state: "SUCCESS",
    completed_at: "2026-05-06T10:00:00Z",
    duration_ms: 4500,
  },
  images: [
    {
      display_name: "login_screen.png",
      group: "auth",
      image_file_name: "snapshots-iphone-16/auth_login_screen.png",
      description: "Auth login view",
    },
    {
      display_name: "dashboard.png",
      group: "main",
      image_file_name: "snapshots-iphone-16/main_dashboard.png",
      description: "Main dashboard",
    },
    {
      display_name: "new_modal.png",
      group: "dialogs",
      image_file_name: "snapshots-iphone-16/dialogs_new_modal.png",
      description: "New dialog modal",
    },
    {
      display_name: "settings_page.png",
      group: "settings",
      image_file_name: "snapshots-iphone-16/settings_page.png",
      description: "Settings page",
    },
  ],
  changed: [
    {
      head_image: {
        display_name: "login_screen.png",
        group: "auth",
        image_file_name: "snapshots-iphone-16/auth_login_screen.png",
      },
      base_image: {
        display_name: "login_screen.png",
        group: "auth",
        image_file_name: "snapshots-iphone-16/auth_login_screen.png",
      },
      diff: 0.125,
    },
    {
      head_image: {
        display_name: "dashboard.png",
        group: "main",
        image_file_name: "snapshots-iphone-16/main_dashboard.png",
      },
      base_image: {
        display_name: "dashboard.png",
        group: "main",
        image_file_name: "snapshots-iphone-16/main_dashboard.png",
      },
      diff: 0.021,
    },
  ],
  added: [
    {
      display_name: "new_modal.png",
      group: "dialogs",
      image_file_name: "snapshots-iphone-16/dialogs_new_modal.png",
    },
  ],
  renamed: [
    {
      head_image: {
        display_name: "settings_page.png",
        group: "settings",
        image_file_name: "snapshots-iphone-16/settings_page.png",
      },
      base_image: {
        display_name: "preferences_page.png",
        group: "settings",
        image_file_name: "snapshots-iphone-16/preferences_page.png",
      },
      diff: null,
    },
  ],
  removed: [],
  errored: [],
  unchanged: [],
};

const LONG_CONTEXT_VALUE = "x".repeat(220);

const headImageInfo = {
  content_hash: "abc123",
  display_name: "login_screen.png",
  group: "auth",
  image_file_name: "snapshots-iphone-16/auth_login_screen.png",
  width: 1080,
  height: 1920,
  description: null,
  image_url:
    "/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen.png/download/",
  context: {
    empty_object: {},
    empty_string: "",
    metadata: {
      enabled: true,
      metrics: {
        attempts: 2,
        ratio: 0.25,
      },
      unsupported_array: ["hidden"],
      unsupported_null: null,
    },
    deep: {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: "visible",
            },
          },
        },
      },
    },
    long_value: LONG_CONTEXT_VALUE,
    preview: {
      container_display_name: "Auth Login",
      display_name: "login_screen.png",
    },
    simulator: { device_name: "iPhone 16" },
    test_name: "LoginUITests.testLoginScreen",
  },
};

const baseImageInfo = {
  content_hash: "def456",
  display_name: "login_screen.png",
  group: "auth",
  image_file_name: "snapshots-iphone-16/auth_login_screen.png",
  width: 1080,
  height: 1920,
  description: null,
  image_url:
    "/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen_base.png/download/",
};

const changedImageDetailFixture = {
  image_file_name: "snapshots-iphone-16/auth_login_screen.png",
  comparison_status: "changed",
  head_image: headImageInfo,
  base_image: baseImageInfo,
  diff_image_url:
    "/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen_diff.png/download/",
  diff_percentage: 0.125,
  previous_image_file_name: null,
};

const addedImageDetailFixture = {
  image_file_name: "snapshots-iphone-16/auth_login_screen.png",
  comparison_status: "added",
  head_image: headImageInfo,
  base_image: null,
  diff_image_url: null,
  diff_percentage: null,
  previous_image_file_name: null,
};

const removedImageDetailFixture = {
  image_file_name: "snapshots-iphone-16/auth_login_screen.png",
  comparison_status: "removed",
  head_image: null,
  base_image: baseImageInfo,
  diff_image_url: null,
  diff_percentage: null,
  previous_image_file_name: null,
};

const renamedImageDetailFixture = {
  image_file_name: "snapshots-iphone-16/auth_login_screen.png",
  comparison_status: "renamed",
  head_image: headImageInfo,
  base_image: {
    ...baseImageInfo,
    image_file_name: "snapshots-iphone-16/old_login.png",
  },
  diff_image_url: null,
  diff_percentage: null,
  previous_image_file_name: "snapshots-iphone-16/old_login.png",
};

const fakePng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAIElEQVR4XmNgYDjx3waIK4B4CxAzMFQABYC4Aoi3ADEAHl0S6cHvzCcAAAAASUVORK5CYII=",
    "base64",
  ),
);
const fakeJpeg = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSgBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAIABAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AI/D2mWH9lxf6Da/9+l/wr7HFYir7R+8/vZ0ZBiq/wBSh77+9n//2Q==",
    "base64",
  ),
);

const largeSixteenBitPng = createSolidSixteenBitPng(1200, 600);

function createSolidSixteenBitPng(width: number, height: number): Uint8Array {
  const data = new Uint16Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    data[offset] = 65535;
    data[offset + 1] = 32768;
    data[offset + 2] = 0;
    data[offset + 3] = 65535;
  }

  return encodePng({
    width,
    height,
    data,
    depth: 16,
    channels: 4,
  });
}

const IMAGE_DETAIL_PATH =
  "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/login_screen.png/";
const SLASH_IMAGE_IDENTIFIER =
  "snapshots-iphone-17e/test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png";
const SLASH_IMAGE_DETAIL_PATH = `https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/${encodeURIComponent(SLASH_IMAGE_IDENTIFIER)}/`;
const HEAD_DOWNLOAD_PATH =
  "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen.png/download/";
const BASE_DOWNLOAD_PATH =
  "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen_base.png/download/";
const DIFF_DOWNLOAD_PATH =
  "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen_diff.png/download/";

function setupSnapshotMock() {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/",
      () => HttpResponse.json(snapshotFixture),
      { once: true },
    ),
  );
}

function setupChangedImageMocks() {
  mswServer.use(
    http.get(
      IMAGE_DETAIL_PATH,
      () => HttpResponse.json(changedImageDetailFixture),
      { once: true },
    ),
    http.get(
      HEAD_DOWNLOAD_PATH,
      () =>
        new HttpResponse(fakePng, { headers: { "content-type": "image/png" } }),
      { once: true },
    ),
    http.get(
      BASE_DOWNLOAD_PATH,
      () =>
        new HttpResponse(fakeJpeg, {
          headers: { "content-type": "image/jpeg" },
        }),
      { once: true },
    ),
    http.get(
      DIFF_DOWNLOAD_PATH,
      () =>
        new HttpResponse(fakePng, { headers: { "content-type": "image/png" } }),
      { once: true },
    ),
  );
}

function setupAddedImageMocks() {
  mswServer.use(
    http.get(
      IMAGE_DETAIL_PATH,
      () => HttpResponse.json(addedImageDetailFixture),
      { once: true },
    ),
    http.get(
      HEAD_DOWNLOAD_PATH,
      () =>
        new HttpResponse(fakePng, { headers: { "content-type": "image/png" } }),
      { once: true },
    ),
  );
}

describe("get_snapshot_details", () => {
  it("parses snapshot URL and returns curated summary", async () => {
    setupSnapshotMock();
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;
    expect(text).toContain("# Snapshot 231949 in **sentry**");
    expect(text).toContain("**Type**: diff");
    expect(text).toContain("**State**: visible");
    expect(text).toContain("2 changed, 1 added, 0 removed, 1 renamed");
    expect(text).toContain("**Repo**: getsentry/sentry");
    expect(text).toContain("**Head**: feature/new-login (`abc123de`)");
    expect(text).toContain("**Base**: main (`00011122`)");
    expect(text).toContain("**PR**: #789");
    expect(text).toContain("**Approval**: requires_approval");
    expect(text).toContain(
      "auth_login_screen.png — 12.5% diff — login_screen.png — auth",
    );
    expect(text).toContain(
      "main_dashboard.png — 2.1% diff — dashboard.png — main",
    );
    expect(text).toContain("**Added:**");
    expect(text).toContain("dialogs_new_modal.png — new_modal.png — dialogs");
    expect(text).toContain("**Renamed:**");
    expect(text).toContain(
      "settings_page.png — previous: preferences_page.png — settings",
    );
    expect(text).toContain("get_sentry_resource");
    expect(text).toMatchInlineSnapshot(`
      "# Snapshot 231949 in **sentry**

      ## Summary

      - **URL**: https://sentry.sentry.io/preprod/snapshots/231949/
      - **Type**: diff
      - **State**: visible
      - **Project ID**: 12345
      - **Images**: 4 total (2 changed, 1 added, 0 removed, 1 renamed, 10 unchanged, 0 errored, 0 skipped)

      ## VCS Info

      - **Repo**: getsentry/sentry
      - **Head**: feature/new-login (\`abc123de\`)
      - **Base**: main (\`00011122\`)
      - **PR**: #789

      - **Approval**: requires_approval

      ## Changes

      **Changed:**
      └── snapshots-iphone-16/
          ├── auth_login_screen.png — 12.5% diff — login_screen.png — auth
          └── main_dashboard.png — 2.1% diff — dashboard.png — main

      **Added:**
      └── snapshots-iphone-16/
          └── dialogs_new_modal.png — new_modal.png — dialogs

      **Renamed:**
      └── snapshots-iphone-16/
          └── settings_page.png — previous: preferences_page.png — settings

      ## Next Steps

      - To view a specific image preview, use \`get_sentry_resource(url="https://sentry.sentry.io/preprod/snapshots/231949/?selectedSnapshot=<image_file_name>")\`
      - To fetch original full-resolution image bytes, append \`&imageResolution=full\` to the selected-image URL"
    `);
  });

  it("works with explicit org slug and snapshot ID", async () => {
    setupSnapshotMock();
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: null,
        organizationSlug: "sentry",
        snapshotId: "231949",
        selectedSnapshot: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;
    expect(text).toContain("**Type**: diff");
    expect(text).toContain("2 changed");
  });

  it("throws on missing params", async () => {
    await expect(
      getSnapshotDetails.handler(
        {
          snapshotUrl: null,
          organizationSlug: null,
          snapshotId: null,
          selectedSnapshot: null,
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow("Provide either snapshotUrl or both");
  });

  it("throws on invalid URL", async () => {
    await expect(
      getSnapshotDetails.handler(
        {
          snapshotUrl: "https://example.com/not-a-snapshot",
          organizationSlug: null,
          snapshotId: null,
          selectedSnapshot: null,
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow("Could not parse snapshot URL");
  });

  it("handles 404 error", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/999999/",
        () => HttpResponse.json({ detail: "Not found" }, { status: 404 }),
        { once: true },
      ),
    );
    await expect(
      getSnapshotDetails.handler(
        {
          snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/999999/",
          organizationSlug: null,
          snapshotId: null,
          selectedSnapshot: null,
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow();
  });

  it("handles solo comparison type with images array", async () => {
    const soloFixture = {
      head_artifact_id: "232703",
      base_artifact_id: null,
      project_id: "12345",
      comparison_type: "solo",
      state: "visible",
      vcs_info: {
        head_sha: "abc123",
        base_sha: null,
        head_ref: "main",
        base_ref: null,
        pr_number: null,
        provider: "github",
        repo_name: "EmergeTools/hackernews",
      },
      images: [
        {
          display_name: "Dark mode",
          group: "Content View",
          image_file_name: "snapshots-ipad/Content_View_Dark_mode.png",
          description: "Dark mode content view",
        },
      ],
      changed: [],
      added: [],
      removed: [],
      renamed: [],
      errored: [],
      unchanged: [],
      changed_count: 0,
      added_count: 0,
      removed_count: 0,
      renamed_count: 0,
      unchanged_count: 0,
      errored_count: 0,
      skipped_count: 0,
    };
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/232703/",
        () => HttpResponse.json(soloFixture),
        { once: true },
      ),
    );
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: null,
        organizationSlug: "sentry",
        snapshotId: "232703",
        selectedSnapshot: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;
    expect(text).toContain("**Type**: solo");
    expect(text).toContain(
      "Content_View_Dark_mode.png — Dark mode — Content View",
    );
  });

  it("groups large diff summaries without listing unchanged details", async () => {
    const largeFixture = {
      ...snapshotFixture,
      changed_count: 3,
      added_count: 1,
      removed_count: 1,
      renamed_count: 1,
      unchanged_count: 42,
      errored_count: 1,
      skipped_count: 2,
      images: [
        ...snapshotFixture.images,
        {
          display_name: "unchanged_detail.png",
          group: "unchanged",
          image_file_name: "snapshots-iphone-17e/unchanged_detail.png",
        },
      ],
      changed: [
        {
          head_image: {
            display_name: "Kenya",
            group: "FeaturedProductCard",
            image_file_name:
              "snapshots-iphone-17e/test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png",
          },
          diff: 0.2605,
        },
        {
          head_image: {
            display_name: "Ethiopia",
            group: "FeaturedProductCard",
            image_file_name:
              "snapshots-iphone-17e/test_CoffeeProductCards.swift_FeaturedProductCard_Ethiopia.png",
          },
          diff: 0.2341,
        },
        {
          head_image: {
            display_name: "Kenya",
            group: "FeaturedProductCard",
            image_file_name:
              "snapshots-iphone-17-pro-max/test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png",
          },
          diff: 0.234,
        },
      ],
      added: [
        {
          display_name: "New Cart",
          group: "Cart",
          image_file_name: "snapshots-iphone-17e/test_Cart.swift_NewCart.png",
        },
      ],
      removed: [
        {
          display_name: "Old Cart",
          group: "Cart",
          image_file_name: "snapshots-iphone-17e/test_Cart.swift_OldCart.png",
        },
      ],
      renamed: [
        {
          head_image: {
            display_name: "Settings",
            group: "Settings",
            image_file_name:
              "snapshots-iphone-17e/test_Settings.swift_Settings.png",
          },
          base_image: {
            display_name: "Preferences",
            group: "Settings",
            image_file_name:
              "snapshots-iphone-17e/test_Settings.swift_Preferences.png",
          },
        },
      ],
      errored: [
        {
          head_image: {
            display_name: "Error State",
            group: "Errors",
            image_file_name:
              "snapshots-iphone-17e/test_Error.swift_ErrorState.png",
          },
        },
      ],
    };

    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/",
        () => HttpResponse.json(largeFixture),
        { once: true },
      ),
    );

    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: null,
        regionUrl: null,
      },
      getServerContext(),
    );
    const text = result as string;

    expect(text).toContain(
      "3 changed, 1 added, 1 removed, 1 renamed, 42 unchanged, 1 errored, 2 skipped",
    );
    expect(text).toContain("└── snapshots-iphone-17-pro-max/");
    expect(text).toContain("├── snapshots-iphone-17e/");
    expect(text).toContain(
      "test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png — 26.05% diff — Kenya — FeaturedProductCard",
    );
    expect(text).toContain("**Added:**");
    expect(text).toContain("**Removed:**");
    expect(text).toContain("**Renamed:**");
    expect(text).toContain("**Errored:**");
    expect(text).not.toContain("## All Images");
    expect(text).not.toContain("unchanged_detail.png");
  });

  it("returns head, base, and diff images for changed comparison", async () => {
    setupChangedImageMocks();
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    const imageParts = parts.filter(
      (p): p is ImageContent => p.type === "image",
    );
    expect(textParts[0]!.text).toContain("**Status**: changed");
    expect(textParts[0]!.text).toContain("**Diff**: 12.5%");
    expect(textParts[0]!.text).toContain("**Image Resolution**: preview");
    expect(textParts[0]!.text).toContain("append `&imageResolution=full`");
    expect(textParts[0]!.text).toContain("**Group**: auth");
    expect(textParts[0]!.text).toContain("1080×1920");
    expect(textParts[0]!.text).toContain("### Context");
    expect(textParts[0]!.text).toContain(
      "- **metadata**:\n  - **enabled**: true\n  - **metrics**:\n    - **attempts**: 2\n    - **ratio**: 0.25",
    );
    expect(textParts[0]!.text).toContain("          - **level5**: visible");
    expect(textParts[0]!.text).toContain(
      `- **long_value**: ${LONG_CONTEXT_VALUE}`,
    );
    expect(textParts[0]!.text).not.toContain("more context lines omitted");
    expect(textParts[0]!.text).toContain(
      "- **preview**:\n  - **container_display_name**: Auth Login\n  - **display_name**: login_screen.png",
    );
    expect(textParts[0]!.text).toContain(
      "- **simulator**:\n  - **device_name**: iPhone 16",
    );
    expect(textParts[0]!.text).toContain(
      "- **test_name**: LoginUITests.testLoginScreen",
    );
    expect(textParts[0]!.text).not.toContain("empty_object");
    expect(textParts[0]!.text).not.toContain("empty_string");
    expect(textParts[0]!.text).not.toContain("unsupported_array");
    expect(textParts[0]!.text).not.toContain("unsupported_null");
    expect(imageParts.length).toBe(3);
    expect(imageParts[0]!.mimeType).toBe("image/png");
    expect(imageParts[1]!.mimeType).toBe("image/jpeg");
    expect(imageParts[2]!.mimeType).toBe("image/png");
    expect(textParts[1]!.text).toBe("### Head (current) — preview");
    expect(textParts[2]!.text).toBe("### Base (previous) — preview");
    expect(textParts[3]!.text).toBe("### Diff Mask — preview");
  });

  it("downsamples 16-bit PNGs in selected image responses", async () => {
    mswServer.use(
      http.get(
        IMAGE_DETAIL_PATH,
        () => HttpResponse.json(addedImageDetailFixture),
        { once: true },
      ),
      http.get(
        HEAD_DOWNLOAD_PATH,
        () =>
          new HttpResponse(largeSixteenBitPng, {
            headers: { "content-type": "image/png" },
          }),
        { once: true },
      ),
    );

    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    const imageParts = parts.filter(
      (p): p is ImageContent => p.type === "image",
    );

    expect(textParts[1]!.text).toBe("### Head (current) — preview");
    expect(imageParts.length).toBe(1);
    expect(imageParts[0]!.mimeType).toBe("image/png");
    expect(imageParts[0]!.data).not.toBe(
      Buffer.from(largeSixteenBitPng).toString("base64"),
    );

    const decoded = decodePng(Buffer.from(imageParts[0]!.data, "base64"));
    expect(decoded.width).toBe(1024);
    expect(decoded.height).toBe(512);
    expect(decoded.depth).toBe(8);
  });

  it("returns original image bytes when full resolution is requested", async () => {
    setupChangedImageMocks();
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl:
          "https://sentry.sentry.io/preprod/snapshots/231949/?selectedSnapshot=login_screen.png&imageResolution=full",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    const imageParts = parts.filter(
      (p): p is ImageContent => p.type === "image",
    );

    expect(textParts[0]!.text).toContain("**Image Resolution**: full");
    expect(textParts[0]!.text).not.toContain("append `&imageResolution=full`");
    expect(textParts[1]!.text).toBe("### Head (current) — full");
    expect(textParts[2]!.text).toBe("### Base (previous) — full");
    expect(textParts[3]!.text).toBe("### Diff Mask — full");
    expect(imageParts[0]!.data).toBe(Buffer.from(fakePng).toString("base64"));
    expect(imageParts[1]!.data).toBe(Buffer.from(fakeJpeg).toString("base64"));
  });

  it("throws on invalid image resolution query values", async () => {
    await expect(
      getSnapshotDetails.handler(
        {
          snapshotUrl:
            "https://sentry.sentry.io/preprod/snapshots/231949/?selectedSnapshot=login_screen.png&imageResolution=thumbnail",
          organizationSlug: null,
          snapshotId: null,
          selectedSnapshot: "login_screen.png",
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow("Invalid imageResolution query value");
  });

  it("does not return full image bytes when preview generation fails", async () => {
    const invalidPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    mswServer.use(
      http.get(
        IMAGE_DETAIL_PATH,
        () => HttpResponse.json(addedImageDetailFixture),
        { once: true },
      ),
      http.get(
        HEAD_DOWNLOAD_PATH,
        () =>
          new HttpResponse(invalidPng, {
            headers: { "content-type": "image/png" },
          }),
        { once: true },
      ),
    );

    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    const imageParts = parts.filter(
      (p): p is ImageContent => p.type === "image",
    );

    expect(textParts[1]!.text).toBe(
      "### Head (current) — preview unavailable. Retry with imageResolution=full to fetch the original image.",
    );
    expect(imageParts.length).toBe(0);
  });

  it("returns only head image for added comparison", async () => {
    setupAddedImageMocks();
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    const imageParts = parts.filter(
      (p): p is ImageContent => p.type === "image",
    );
    expect(textParts[0]!.text).toContain("**Status**: added");
    expect(textParts[0]!.text).not.toContain("**Diff**:");
    expect(imageParts.length).toBe(1);
    expect(imageParts[0]!.mimeType).toBe("image/png");
    expect(textParts[1]!.text).toBe("### Head (current) — preview");
  });

  it("encodes slash-containing selected image identifiers as one path segment", async () => {
    const slashImageDetailFixture = {
      ...addedImageDetailFixture,
      image_file_name: SLASH_IMAGE_IDENTIFIER,
      head_image: {
        ...headImageInfo,
        image_file_name: SLASH_IMAGE_IDENTIFIER,
      },
    };

    mswServer.use(
      http.get(
        SLASH_IMAGE_DETAIL_PATH,
        () => HttpResponse.json(slashImageDetailFixture),
        { once: true },
      ),
      http.get(
        HEAD_DOWNLOAD_PATH,
        () =>
          new HttpResponse(fakePng, {
            headers: { "content-type": "image/png" },
          }),
        { once: true },
      ),
    );

    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: SLASH_IMAGE_IDENTIFIER,
        regionUrl: null,
      },
      getServerContext(),
    );

    const parts = result as (TextContent | ImageContent)[];
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    expect(textParts[0]!.text).toContain(`## ${SLASH_IMAGE_IDENTIFIER}`);
    expect(textParts[0]!.text).toContain(
      `- **File**: \`${SLASH_IMAGE_IDENTIFIER}\``,
    );
  });

  it("returns only base image for removed comparison", async () => {
    mswServer.use(
      http.get(
        IMAGE_DETAIL_PATH,
        () => HttpResponse.json(removedImageDetailFixture),
        { once: true },
      ),
      http.get(
        BASE_DOWNLOAD_PATH,
        () =>
          new HttpResponse(fakePng, {
            headers: { "content-type": "image/png" },
          }),
        { once: true },
      ),
    );
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const imageParts = parts.filter(
      (p): p is ImageContent => p.type === "image",
    );
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    expect(textParts[0]!.text).toContain("**Status**: removed");
    expect(imageParts.length).toBe(1);
    expect(textParts[1]!.text).toBe("### Base (previous) — preview");
  });

  it("shows previous_image_file_name for renamed images", async () => {
    mswServer.use(
      http.get(
        IMAGE_DETAIL_PATH,
        () => HttpResponse.json(renamedImageDetailFixture),
        { once: true },
      ),
      http.get(
        HEAD_DOWNLOAD_PATH,
        () =>
          new HttpResponse(fakePng, {
            headers: { "content-type": "image/png" },
          }),
        { once: true },
      ),
      http.get(
        BASE_DOWNLOAD_PATH,
        () =>
          new HttpResponse(fakePng, {
            headers: { "content-type": "image/png" },
          }),
        { once: true },
      ),
    );
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const textParts = parts.filter((p): p is TextContent => p.type === "text");
    expect(textParts[0]!.text).toContain("**Status**: renamed");
    expect(textParts[0]!.text).toContain(
      "**Previous File**: `snapshots-iphone-16/old_login.png`",
    );
  });

  it("detects image type from magic bytes when content-type is application/octet-stream", async () => {
    mswServer.use(
      http.get(
        IMAGE_DETAIL_PATH,
        () => HttpResponse.json(addedImageDetailFixture),
        { once: true },
      ),
      http.get(
        HEAD_DOWNLOAD_PATH,
        () =>
          new HttpResponse(fakePng, {
            headers: { "content-type": "application/octet-stream" },
          }),
        { once: true },
      ),
    );
    const result = await getSnapshotDetails.handler(
      {
        snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
        organizationSlug: null,
        snapshotId: null,
        selectedSnapshot: "login_screen.png",
        regionUrl: null,
      },
      getServerContext(),
    );
    const parts = result as (TextContent | ImageContent)[];
    const imageParts = parts.filter(
      (p): p is ImageContent => p.type === "image",
    );
    expect(imageParts.length).toBe(1);
    expect(imageParts[0]!.mimeType).toBe("image/png");
  });

  it("throws when no image data is available", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/missing.png/",
        () =>
          HttpResponse.json({
            image_file_name: "missing.png",
            comparison_status: null,
            head_image: null,
            base_image: null,
            diff_image_url: null,
            diff_percentage: null,
            previous_image_file_name: null,
          }),
        { once: true },
      ),
    );
    await expect(
      getSnapshotDetails.handler(
        {
          snapshotUrl: "https://sentry.sentry.io/preprod/snapshots/231949/",
          organizationSlug: null,
          snapshotId: null,
          selectedSnapshot: "missing.png",
          regionUrl: null,
        },
        getServerContext(),
      ),
    ).rejects.toThrow("No image data returned");
  });
});
