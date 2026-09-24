import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  assertStructuredOnlyResult,
  getStructuredContent,
} from "../../test-utils/structured-content";
import { prepareToolParams } from "../catalog-runtime/availability";
import deleteAlertRule from "./delete-alert-rule";

const context = {
  constraints: { organizationSlug: null },
  accessToken: "access-token",
  userId: "1",
};
const params = {
  organizationSlug: "sentry-mcp-evals",
  regionUrl: null,
  ruleId: "123",
};
const endpoint =
  "https://sentry.io/api/0/organizations/sentry-mcp-evals/workflows/123/";
const projectId = "4509109104082945";
const scopedContext = {
  ...context,
  constraints: { projectSlug: "cloudflare-mcp" },
};

function useDeleteHandler(status = 204) {
  const writes: string[] = [];
  mswServer.use(
    http.delete(endpoint, ({ request }) => {
      writes.push(request.url);
      return new HttpResponse(null, { status });
    }),
  );
  return writes;
}

function useProjectScope(projectIds: string[], includesAllProjects = false) {
  mswServer.use(
    http.get(`${endpoint}project-scope/`, () =>
      HttpResponse.json({ projectIds, includesAllProjects }),
    ),
  );
}

describe("delete_alert_rule", () => {
  it("deletes an Alert exclusively affecting the constrained project", async () => {
    const writes = useDeleteHandler();
    useProjectScope([projectId]);
    const result = await deleteAlertRule.handler(params, scopedContext);

    expect(writes).toEqual([endpoint]);
    assertStructuredOnlyResult(result);
    expect(getStructuredContent(result)).toMatchInlineSnapshot(`
      {
        "ruleId": "123",
        "success": true,
      }
    `);
  });

  it.each([
    { projectIds: [projectId, "200"], includesAllProjects: false },
    { projectIds: [projectId], includesAllProjects: true },
    { projectIds: [], includesAllProjects: false },
    { projectIds: ["200"], includesAllProjects: false },
  ])("rejects unsafe project scope %j before deleting", async (scope) => {
    const writes = useDeleteHandler();
    useProjectScope(scope.projectIds, scope.includesAllProjects);
    await expect(
      deleteAlertRule.handler(params, scopedContext),
    ).rejects.toThrow("outside the active project constraint");
    expect(writes).toEqual([]);
  });

  it.each([403, 404])(
    "propagates DELETE %s without reporting success",
    async (status) => {
      const writes = useDeleteHandler(status);
      await expect(
        deleteAlertRule.handler(params, context),
      ).rejects.toMatchObject({ status });
      expect(writes).toEqual([endpoint]);
    },
  );

  it.each(["Backend notifications", "detector:123"])(
    "requires a numeric workflow ID, rejecting %s",
    (ruleId) => {
      expect(() =>
        prepareToolParams({
          tool: deleteAlertRule,
          params: { ...params, ruleId },
          context,
        }),
      ).toThrow("Invalid arguments for delete_alert_rule");
    },
  );
});
