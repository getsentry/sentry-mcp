import { describe, expect, it } from "vitest";
import { prepareToolParams } from "../catalog-runtime/availability";
import type { ToolConfig } from "../types";
import { getServerContext } from "../../test-setup";
import findProjects from "./find-projects";
import getMonitorDetails from "./get-monitor-details";
import getReleaseDetails from "./get-release-details";
import searchIssues from "./search-issues";
import updateProject from "./update-project";

function parseToolParams(tool: ToolConfig, params: Record<string, unknown>) {
  return prepareToolParams({
    tool,
    params,
    context: getServerContext(),
  });
}

describe("slug parameter case preservation", () => {
  it("preserves mixed-case resource slugs during tool parameter parsing", () => {
    expect(
      parseToolParams(findProjects, {
        organizationSlug: " MyOrg ",
        regionUrl: null,
        query: null,
      }),
    ).toMatchObject({
      organizationSlug: "MyOrg",
    });

    expect(
      parseToolParams(searchIssues, {
        organizationSlug: "MyOrg",
        projectSlugOrId: " MyProject ",
      }),
    ).toMatchObject({
      organizationSlug: "MyOrg",
      projectSlugOrId: "MyProject",
    });

    expect(
      parseToolParams(getMonitorDetails, {
        organizationSlug: "MyOrg",
        projectSlugOrId: " MyProject ",
        monitorSlug: "nightly-import",
      }),
    ).toMatchObject({
      organizationSlug: "MyOrg",
      projectSlugOrId: "MyProject",
    });

    expect(
      parseToolParams(getReleaseDetails, {
        organizationSlug: "MyOrg",
        releaseVersion: "1.2.3",
        projectSlugOrId: " MyProject ",
      }),
    ).toMatchObject({
      organizationSlug: "MyOrg",
      projectSlugOrId: "MyProject",
    });

    expect(
      parseToolParams(updateProject, {
        organizationSlug: "MyOrg",
        projectSlug: " OldProject ",
        name: null,
        slug: " NewProject ",
        platform: null,
        teamSlug: " MyTeam ",
        regionUrl: null,
      }),
    ).toMatchObject({
      organizationSlug: "MyOrg",
      projectSlug: "OldProject",
      slug: "NewProject",
      teamSlug: "MyTeam",
    });
  });
});
