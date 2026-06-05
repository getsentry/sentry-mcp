import { mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import getAlertDetails from "./get-alert-details.js";

const context = {
  constraints: {
    organizationSlug: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("get_alert_details", () => {
  it("serializes alert details", async () => {
    const result = await getAlertDetails.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: null,
        alertId: "1001",
        includeDetectors: true,
      },
      context,
    );

    expect(result).toMatchInlineSnapshot(`
      "# Alert Critical Errors to Slack

      **Alert ID**: 1001
      **Enabled**: yes
      **Created By**: 12345
      **Environment**: production
      **Created**: 2025-04-10T10:00:00.000Z
      **Updated**: 2025-04-14T10:00:00.000Z

      ## When

      {"id":"3001","organizationId":"1","logicType":"all","conditions":[{"id":"4001","type":"event_frequency_count","comparison":{"value":1,"interval":"1h"},"conditionResult":true}],"actions":[]}

      ## Actions

      - {"id":"3002","organizationId":"1","logicType":"all","conditions":[{"id":"4002","type":"tagged_event","comparison":{"key":"level","match":"eq","value":"error"},"conditionResult":true}],"actions":[{"id":"5001","type":"slack","integrationId":null,"data":{"targetType":"specific","targetIdentifier":"#alerts-critical"},"config":{},"status":"active"}]}

      ## Detector IDs

      - 2001

      ## Connected Detectors

      ### Unhandled Errors

      **Detector ID**: 2001
      **Type**: error
      **Enabled**: yes
      **Project**: 4509062593708032
      **Owner**: the-goats
      **Created**: 2025-04-10T09:00:00.000Z
      **Updated**: 2025-04-14T09:30:00.000Z

      ## Response Notes

      - Alert workflows are the workflow-engine representation of Sentry alerts.
      "
    `);
  });

  it("rejects alerts without detectors in the active project constraint", async () => {
    mswServer.use(
      http.get(
        "https://sentry.io/api/0/organizations/sentry-mcp-evals/detectors/",
        ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("projectSlug") === "frontend") {
            return HttpResponse.json([]);
          }
          return HttpResponse.json([
            {
              id: "2001",
              projectId: "4509062593708032",
              name: "Unhandled Errors",
            },
          ]);
        },
      ),
    );

    await expect(
      getAlertDetails.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          alertId: "1001",
          includeDetectors: false,
        },
        {
          ...context,
          constraints: {
            organizationSlug: "sentry-mcp-evals",
            projectSlug: "frontend",
          },
        },
      ),
    ).rejects.toThrow(
      'Alert is outside the active project constraint. Expected project "frontend".',
    );
  });
});
