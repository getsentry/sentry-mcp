import { describe, it, expect } from "vitest";
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

const imageDetailFixture = {
  display_name: "login_screen.png",
  group: "auth",
  image_file_name: "snapshots-iphone-16/auth_login_screen.png",
  width: 1080,
  height: 1920,
  context: {
    preview: {
      container_display_name: "Auth Login",
      display_name: "login_screen.png",
    },
    simulator: { device_name: "iPhone 16" },
  },
  image_url:
    "/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen.png/download/",
};

const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function setupSnapshotMock() {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/",
      () => HttpResponse.json(snapshotFixture),
      { once: true },
    ),
  );
}

function setupImageMocks() {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/login_screen.png/",
      () => HttpResponse.json(imageDetailFixture),
      { once: true },
    ),
    http.get(
      "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/auth_login_screen.png/download/",
      () =>
        new HttpResponse(fakePng, {
          headers: { "content-type": "image/png" },
        }),
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
      "`login_screen.png` (auth) — file: `snapshots-iphone-16/auth_login_screen.png` — 12.5% diff",
    );
    expect(text).toContain(
      "`dashboard.png` (main) — file: `snapshots-iphone-16/main_dashboard.png` — 2.1% diff",
    );
    expect(text).toContain("**Added:**");
    expect(text).toContain("`new_modal.png` (dialogs)");
    expect(text).toContain("**Renamed:**");
    expect(text).toContain("`preferences_page.png` → `settings_page.png`");
    expect(text).toContain("get_sentry_resource");
    expect(text).toMatchInlineSnapshot(`
      "# Snapshot 231949 in **sentry**

      ## Summary

      - **URL**: https://sentry.sentry.io/preprod/snapshots/231949/
      - **Type**: diff
      - **State**: visible
      - **Project ID**: 12345
      - **Images**: 4 total (2 changed, 1 added, 0 removed, 1 renamed, 10 unchanged, 0 errored)

      ## VCS Info

      - **Repo**: getsentry/sentry
      - **Head**: feature/new-login (\`abc123de\`)
      - **Base**: main (\`00011122\`)
      - **PR**: #789

      - **Approval**: requires_approval

      ## Changes

      **Changed:**
      - \`login_screen.png\` (auth) — file: \`snapshots-iphone-16/auth_login_screen.png\` — 12.5% diff
      - \`dashboard.png\` (main) — file: \`snapshots-iphone-16/main_dashboard.png\` — 2.1% diff

      **Added:**
      - \`new_modal.png\` (dialogs) — file: \`snapshots-iphone-16/dialogs_new_modal.png\`

      **Renamed:**
      - \`preferences_page.png\` → \`settings_page.png\`

      ## All Images

      - \`login_screen.png\` (auth) — file: \`snapshots-iphone-16/auth_login_screen.png\`
      - \`dashboard.png\` (main) — file: \`snapshots-iphone-16/main_dashboard.png\`
      - \`new_modal.png\` (dialogs) — file: \`snapshots-iphone-16/dialogs_new_modal.png\`
      - \`settings_page.png\` (settings) — file: \`snapshots-iphone-16/settings_page.png\`

      ## Next Steps

      - To view a specific image, use \`get_sentry_resource(url="https://sentry.sentry.io/preprod/snapshots/231949/?selectedSnapshot=<image_file_name>")\`"
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
    expect(text).toContain("`Dark mode` (Content View)");
  });

  it("fetches image metadata and binary when selectedSnapshot is provided", async () => {
    setupImageMocks();
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
    expect(textParts[0]!.text).toContain("login_screen.png");
    expect(textParts[0]!.text).toContain("**Group**: auth");
    expect(textParts[0]!.text).toContain("1080×1920");
    expect(textParts[0]!.text).not.toContain("image_url");
    expect(imageParts.length).toBe(1);
    expect(imageParts[0]!.mimeType).toBe("image/png");
    expect(textParts[0]!.text).toMatchInlineSnapshot(`
      "## login_screen.png

      - **Display Name**: login_screen.png
      - **Group**: auth
      - **File**: \`snapshots-iphone-16/auth_login_screen.png\`
      - **Dimensions**: 1080×1920
      - **Container**: Auth Login
      - **Device**: iPhone 16"
    `);
  });

  it("throws when selectedSnapshot image has no image_url", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/images/missing.png/",
        () =>
          HttpResponse.json({
            display_name: "missing.png",
            group: null,
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
    ).rejects.toThrow("No image_url returned");
  });
});
