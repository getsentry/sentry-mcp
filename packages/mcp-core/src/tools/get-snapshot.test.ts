import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "@sentry/mcp-server-mocks";
import getSnapshot from "./get-snapshot.js";
import { getServerContext } from "../test-setup.js";

const snapshotFixture = {
  project_id: "12345",
  comparison_type: "diff",
  state: "visible",
  vcs_info: {
    head_sha: "abc123def",
    base_sha: "000111222",
    head_ref: "feature/new-login",
    base_ref: "main",
    pr_number: "789",
    repo_name: "getsentry/sentry",
  },
  approval_info: {
    status: "requires_approval",
    is_auto_approved: false,
  },
  images: [],
  changed: [
    {
      head_image: {
        display_name: "login_screen.png",
        group: "auth",
        image_file_name: "snapshots-iphone-16/auth_login_screen.png",
      },
      diff: 0.125,
    },
  ],
  added: [
    {
      display_name: "new_modal.png",
      group: "dialogs",
      image_file_name: "snapshots-iphone-16/dialogs_new_modal.png",
    },
  ],
  removed: [],
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
    },
  ],
  errored: [],
  unchanged: [
    {
      display_name: "unchanged.png",
      group: "stable",
      image_file_name: "snapshots-iphone-16/unchanged.png",
    },
  ],
  skipped: [
    {
      display_name: "skipped.png",
      group: "selective-upload",
      image_file_name: "snapshots-iphone-16/skipped.png",
    },
  ],
  total_count: 5,
  changed_count: 1,
  added_count: 1,
  removed_count: 0,
  renamed_count: 1,
  unchanged_count: 1,
  errored_count: 0,
  skipped_count: 1,
};

function setupSnapshotMock(body: Record<string, unknown> = snapshotFixture) {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/231949/",
      ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("compact_metadata")).toBe("true");
        return HttpResponse.json(body);
      },
      { once: true },
    ),
  );
}

function callHandler(
  overrides: Partial<Parameters<typeof getSnapshot.handler>[0]> = {},
) {
  return getSnapshot.handler(
    {
      organizationSlug: "sentry",
      snapshotId: "231949",
      showUnmodified: false,
      regionUrl: null,
      ...overrides,
    },
    getServerContext(),
  );
}

describe("get_snapshot", () => {
  it("returns compact summary output", async () => {
    setupSnapshotMock();

    const result = await callHandler();

    expect(result).toMatchInlineSnapshot(`
      "# Snapshot 231949 in **sentry**

      ## Summary

      - **URL**: https://sentry.sentry.io/preprod/snapshots/231949/
      - **Type**: diff
      - **State**: visible
      - **Project ID**: 12345
      - **Images**: 5 total (1 changed, 1 added, 0 removed, 1 renamed, 1 unchanged, 0 errored, 1 skipped)

      ## VCS Info

      - **Repo**: getsentry/sentry
      - **Head**: feature/new-login (\`abc123de\`)
      - **Base**: main (\`00011122\`)
      - **PR**: #789

      - **Approval**: requires_approval

      ## Changes

      **Changed:**
      └── snapshots-iphone-16/
          └── auth_login_screen.png — 12.5% diff — login_screen.png — auth

      **Added:**
      └── snapshots-iphone-16/
          └── dialogs_new_modal.png — new_modal.png — dialogs

      **Renamed:**
      └── snapshots-iphone-16/
          └── settings_page.png — previous: preferences_page.png — settings

      ## Next Steps

      - To view a specific image preview, use \`get_snapshot_image(organizationSlug="sentry", snapshotId="231949", imageIdentifier="<image_file_name>")\`
      - To fetch original full-resolution image bytes, set \`imageResolution="full"\` in \`get_snapshot_image\`"
    `);
    expect(result).not.toContain("**Unchanged:**");
    expect(result).not.toContain("skipped.png");
  });

  it("throws on missing explicit params", async () => {
    await expect(
      callHandler({
        organizationSlug: null,
        snapshotId: null,
      } as unknown as Partial<Parameters<typeof getSnapshot.handler>[0]>),
    ).rejects.toThrow("Provide both organizationSlug and snapshotId");
  });

  it("lists unchanged and skipped sections when requested", async () => {
    setupSnapshotMock();

    const result = await callHandler({ showUnmodified: true });

    expect(result).toContain("## Unmodified");
    expect(result).toContain("**Unchanged:**");
    expect(result).toContain("unchanged.png — stable");
    expect(result).toContain("**Skipped:**");
    expect(result).toContain("skipped.png — selective-upload");
  });

  it("hints when compact diff output hides the only file lists", async () => {
    setupSnapshotMock({
      ...snapshotFixture,
      changed: [],
      added: [],
      renamed: [],
      unchanged_count: 1,
      skipped_count: 1,
    });

    const result = await callHandler();

    expect(result).toContain(
      "Re-run `get_snapshot` with `showUnmodified=true` to list unchanged and skipped images.",
    );
  });

  it("lists solo snapshot images and treats showUnmodified as a no-op", async () => {
    setupSnapshotMock({
      comparison_type: "solo",
      state: "visible",
      project_id: "12345",
      images: [
        {
          display_name: "Dark mode",
          group: "Content View",
          image_file_name: "snapshots-ipad/Content_View_Dark_mode.png",
        },
      ],
      changed: [],
      added: [],
      removed: [],
      renamed: [],
      errored: [],
      unchanged: [],
      skipped: [],
      total_count: 1,
      changed_count: 0,
      added_count: 0,
      removed_count: 0,
      renamed_count: 0,
      unchanged_count: 0,
      errored_count: 0,
      skipped_count: 0,
    });

    const result = await callHandler({ showUnmodified: true });

    expect(result).toContain("**Snapshot Images:**");
    expect(result).toContain(
      "Content_View_Dark_mode.png — Dark mode — Content View",
    );
    expect(result).not.toContain("## Unmodified");
  });
});
