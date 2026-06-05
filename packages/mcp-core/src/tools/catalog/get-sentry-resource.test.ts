import {
  eventFixture,
  mswServer,
  organizationFixture,
  replayDetailsFixture,
  traceFixture,
  traceMetaFixture,
  traceMixedFixture,
  transactionProfileV1Fixture,
} from "@sentry/mcp-server-mocks";
import { encode as encodePng } from "fast-png";
import { http, HttpResponse } from "msw";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import getMonitorDetails from "./get-monitor-details.js";
import getReleaseDetails from "./get-release-details.js";
import getSentryResource from "./get-sentry-resource.js";

const originalOpenAIApiKey = process.env.OPENAI_API_KEY;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const originalEmbeddedAgentProvider = process.env.EMBEDDED_AGENT_PROVIDER;

const baseContext = {
  constraints: {
    organizationSlug: undefined,
  },
  accessToken: "access-token",
  userId: "1",
};

function mockOrganization(org: string) {
  return http.get(`https://sentry.io/api/0/organizations/${org}/`, () =>
    HttpResponse.json({
      ...organizationFixture,
      slug: org,
      links: {
        ...organizationFixture.links,
        regionUrl: "https://sentry.io",
        organizationUrl: `https://${org}.sentry.io`,
      },
    }),
  );
}

function callHandler(params: {
  url?: string;
  resourceType?:
    | "issue"
    | "event"
    | "trace"
    | "span"
    | "breadcrumbs"
    | "replay"
    | "monitor"
    | "release"
    | "snapshot"
    | "snapshotImage";
  resourceId?: string;
  organizationSlug?: string;
}) {
  return getSentryResource.handler(params, baseContext);
}

function mockMonitorResource({
  apiBaseUrl = "https://sentry.io",
  organizationSlug,
  monitorSlug,
  projectPath,
  projectSlug = "backend",
}: {
  apiBaseUrl?: string;
  organizationSlug: string;
  monitorSlug: string;
  projectPath?: string;
  projectSlug?: string;
}) {
  const organizationMonitorPath = `${apiBaseUrl}/api/0/organizations/${organizationSlug}/monitors/${monitorSlug}/`;
  const projectMonitorPath = `${apiBaseUrl}/api/0/projects/${organizationSlug}/${projectPath ?? projectSlug}/monitors/${monitorSlug}/`;
  const projectId =
    projectPath && /^\d+$/.test(projectPath) ? projectPath : "456";
  const buildMonitor = (slug: string) => ({
    id: "123",
    slug: monitorSlug,
    name: monitorSlug,
    status: "ok",
    project: {
      id: projectId,
      slug,
      name: slug,
    },
    config: {
      schedule: ["crontab", "0 0 * * *"],
    },
  });
  return [
    http.get(organizationMonitorPath, () =>
      HttpResponse.json(buildMonitor("backend")),
    ),
    http.get(
      `${apiBaseUrl}/api/0/projects/${organizationSlug}/${projectSlug}/`,
      () =>
        HttpResponse.json({
          id: projectId,
          slug: projectSlug,
          name: projectSlug,
        }),
    ),
    http.get(`${organizationMonitorPath}checkins/`, () =>
      HttpResponse.json([]),
    ),
    http.get(`${organizationMonitorPath}stats/`, () => HttpResponse.json([])),
    http.get(projectMonitorPath, () =>
      HttpResponse.json(buildMonitor(projectSlug)),
    ),
    http.get(`${projectMonitorPath}checkins/`, () => HttpResponse.json([])),
    http.get(`${projectMonitorPath}stats/`, () => HttpResponse.json([])),
  ];
}

function mockReleaseResource({
  apiBaseUrl = "https://sentry.io",
  organizationSlug,
  releaseVersion,
}: {
  apiBaseUrl?: string;
  organizationSlug: string;
  releaseVersion: string;
}) {
  const encodedVersion = encodeURIComponent(releaseVersion);
  const releasePath = `${apiBaseUrl}/api/0/organizations/${organizationSlug}/releases/${encodedVersion}/`;
  return [
    http.get(releasePath, () =>
      HttpResponse.json({
        id: "789",
        version: releaseVersion,
        shortVersion: releaseVersion,
        dateCreated: "2025-04-13T19:54:21.764000Z",
        projects: [],
      }),
    ),
    http.get(`${releasePath}deploys/`, () => HttpResponse.json([])),
    http.get(`${releasePath}commits/`, () => HttpResponse.json([])),
  ];
}

describe("get_sentry_resource", () => {
  it("keeps release and organization scopes on dedicated detail tools", () => {
    expect(getSentryResource.requiredScopes).toEqual([
      "event:read",
      "project:read",
    ]);
    expect(getMonitorDetails.requiredScopes).toContain("org:read");
    expect(getReleaseDetails.requiredScopes).toContain("project:releases");
  });

  beforeEach(() => {
    Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    Reflect.deleteProperty(process.env, "EMBEDDED_AGENT_PROVIDER");
  });

  afterAll(() => {
    if (originalOpenAIApiKey === undefined) {
      Reflect.deleteProperty(process.env, "OPENAI_API_KEY");
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIApiKey;
    }

    if (originalAnthropicApiKey === undefined) {
      Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }

    if (originalEmbeddedAgentProvider === undefined) {
      Reflect.deleteProperty(process.env, "EMBEDDED_AGENT_PROVIDER");
    } else {
      process.env.EMBEDDED_AGENT_PROVIDER = originalEmbeddedAgentProvider;
    }
  });

  // ─── URL mode: issue URLs ──────────────────────────────────────────────────
  describe("URL mode — issue URLs", () => {
    it("resolves issue from subdomain URL (my-org.sentry.io)", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "Error: Tool list_organizations is already registered",
      );
    });

    it("resolves issue from path-based org URL (/{org}/issues/)", async () => {
      const result = await callHandler({
        url: "https://sentry.io/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("resolves issue from /organizations/{org}/ URL", async () => {
      const result = await callHandler({
        url: "https://sentry.io/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("resolves issue with trailing slash", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });
  });

  // ─── URL mode: event URLs ─────────────────────────────────────────────────
  describe("URL mode — event URLs", () => {
    it("resolves event from /issues/{id}/events/{eventId}", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
    });

    it("resolves event from path-based org URL", async () => {
      const result = await callHandler({
        url: "https://sentry.io/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51",
      });
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
    });
  });

  // ─── URL mode: trace URLs ─────────────────────────────────────────────────
  describe("URL mode — trace URLs", () => {
    const traceId = "a4d1aae7216b47ff8117cf4e09ce9d0a";

    function mockTraceEndpoints(org: string) {
      mswServer.use(
        mockOrganization(org),
        http.get(
          `https://sentry.io/api/0/organizations/${org}/trace-meta/${traceId}/`,
          () => HttpResponse.json(traceMetaFixture),
          { once: true },
        ),
        http.get(
          `https://sentry.io/api/0/organizations/${org}/trace/${traceId}/`,
          () => HttpResponse.json(traceFixture),
          { once: true },
        ),
      );
    }

    it("resolves trace from /explore/traces/trace/{traceId}", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://test-org.sentry.io/explore/traces/trace/${traceId}`,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
      expect(result).toContain("**Total Spans**: 112");
    });

    it("resolves trace from /performance/trace/{traceId}", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://test-org.sentry.io/performance/trace/${traceId}`,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
    });

    it("resolves trace with span focus query param", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://test-org.sentry.io/performance/trace/${traceId}?node=span-aa8e7f3343113fbf`,
      });
      expect(result).toContain(
        `# Span \`aa8e7f3343113fbf\` in Trace \`${traceId}\` in **test-org**`,
      );
      expect(result).toContain(
        "POST https://api.openai.com/v1/chat/completions [http.client · 1708ms · ad0f7c486cc0c787]",
      );
      expect(result).toContain("### Tags");
    });

    it("resolves a span from a compound resourceId", async () => {
      const focusedTraceId = "b4d1aae7216b47ff8117cf4e09ce9d0b";

      mswServer.use(
        mockOrganization("test-org"),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace-meta/${focusedTraceId}/`,
          () =>
            HttpResponse.json({
              logs: 0,
              errors: 2,
              performance_issues: 0,
              span_count: 4,
              transaction_child_count_map: [],
              span_count_map: {},
            }),
          { once: true },
        ),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace/${focusedTraceId}/`,
          () => HttpResponse.json(traceMixedFixture),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "span",
        organizationSlug: "test-org",
        resourceId: `${focusedTraceId}:aa8e7f3384ef4ff5`,
      });

      expect(result).toMatchInlineSnapshot(`
        "# Span \`aa8e7f3384ef4ff5\` in Trace \`b4d1aae7216b47ff8117cf4e09ce9d0b\` in **test-org**

        ## Summary

        **Project**: mcp-server
        **Operation**: function
        **Description**: tools/call search_events
        **Duration**: 5203ms
        **Exclusive Time**: 3495ms
        **Status**: unknown
        **Parent Span ID**: None (root span)
        **Child Spans**: 1
        **Descendant Spans**: 1
        **Errors**: 0
        **Event Type**: span
        **SDK**: sentry.javascript.bun
        **Trace Total Spans**: 4

        ## Child Snapshot

        tools/call search_events [function · 5203ms · aa8e7f3384ef4ff5]
           └─ POST https://api.openai.com/v1/chat/completions [http.client · 1708ms · ad0f7c48fb294de3]

        *Child snapshot shows 1 of 1 descendant spans.*

        ## View Full Span

        **Sentry URL**: https://test-org.sentry.io/explore/traces/trace/b4d1aae7216b47ff8117cf4e09ce9d0b?node=span-aa8e7f3384ef4ff5

        ## Attributes

        ### Core Fields

        \`\`\`json
        {
          "description": "tools/call search_events",
          "duration": 5203,
          "end_timestamp": 1713805463.608875,
          "event_id": "aa8e7f3384ef4ff5850ba966b29ed10d",
          "exclusive_time": 3495,
          "hash": "4ed30c7c-4fae-4c79-b2f1-be95c24e7b04",
          "is_segment": true,
          "op": "function",
          "organization": null,
          "parent_span_id": null,
          "profile_id": "",
          "profiler_id": "",
          "project_id": 4509109107622913,
          "project_slug": "mcp-server",
          "same_process_as_parent": true,
          "sdk_name": "sentry.javascript.bun",
          "span_id": "aa8e7f3384ef4ff5",
          "start_timestamp": 1713805458.405616,
          "status": null,
          "timestamp": 1713805463.608875,
          "trace": "b4d1aae7216b47ff8117cf4e09ce9d0b",
          "transaction_id": "aa8e7f3384ef4ff5850ba966b29ed10d"
        }
        \`\`\`

        ### Measurements

        \`\`\`json
        {}
        \`\`\`

        ### Tags

        \`\`\`json
        {
          "ai.input_messages": "1",
          "ai.model_id": "gpt-4o-2024-08-06",
          "ai.pipeline.name": "search_events",
          "ai.response.finish_reason": "stop",
          "ai.streaming": "false",
          "ai.total_tokens.used": "435",
          "server_name": "mcp-server"
        }
        \`\`\`

        ### Data

        \`\`\`json
        {}
        \`\`\`

        ### Additional Attributes

        \`\`\`json
        {}
        \`\`\`

        ### Errors

        \`\`\`json
        []
        \`\`\`

        ### Occurrences

        \`\`\`json
        []
        \`\`\`

        ## Next Steps

        - **Search spans**: Use the Sentry tool \`search_events(organizationSlug='test-org', dataset='spans', query='trace:b4d1aae7216b47ff8117cf4e09ce9d0b')\`
        - **Search errors**: Use the Sentry tool \`search_events(organizationSlug='test-org', dataset='errors', query='trace:b4d1aae7216b47ff8117cf4e09ce9d0b')\`
        - **Search logs**: Use the Sentry tool \`search_events(organizationSlug='test-org', dataset='logs', query='trace:b4d1aae7216b47ff8117cf4e09ce9d0b')\`"
      `);
    });

    it("resolves trace from /organizations/{org}/ path", async () => {
      mockTraceEndpoints("test-org");
      const result = await callHandler({
        url: `https://sentry.io/organizations/test-org/explore/traces/trace/${traceId}`,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
    });

    it("returns traces under an active project constraint", async () => {
      mockTraceEndpoints("test-org");
      mswServer.use(
        http.get("https://sentry.io/api/0/projects/test-org/frontend/", () => {
          throw new Error("getProject should not be called for trace lookups");
        }),
      );

      const result = await getSentryResource.handler(
        {
          url: `https://test-org.sentry.io/explore/traces/trace/${traceId}`,
        },
        {
          ...baseContext,
          constraints: {
            organizationSlug: "test-org",
            projectSlug: "frontend",
          },
        },
      );

      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
    });
  });

  // ─── URL mode: profile URLs ───────────────────────────────────────────────
  describe("URL mode — profile URLs", () => {
    it("dispatches transaction profile URLs to get_profile_details", async () => {
      const result = await callHandler({
        url: `https://my-org.sentry.io/explore/profiling/profile/backend/${transactionProfileV1Fixture.profile_id}/flamegraph/`,
      });

      expect(result).toContain(
        `# Profile ${transactionProfileV1Fixture.profile_id}`,
      );
      expect(result).toContain("**Project**: backend");
      expect(result).toContain("**Transaction**: /api/users");
    });

    it("dispatches transaction profile URLs with organizations path", async () => {
      const result = await callHandler({
        url: `https://sentry.io/organizations/my-org/profiling/profile/backend/${transactionProfileV1Fixture.profile_id}/flamegraph/?frameName=handle_request`,
      });

      expect(result).toContain(
        `# Profile ${transactionProfileV1Fixture.profile_id}`,
      );
      expect(result).toContain(
        "**Trace ID**: a4d1aae7216b47ff8117cf4e09ce9d0a",
      );
    });

    it("dispatches continuous profile URLs to get_profile_details", async () => {
      const result = await callHandler({
        url: "https://my-org.sentry.io/profiling/profile/backend/flamegraph/?profilerId=041bde57b9844e36b8b7e5734efae5f7&start=2024-01-01T00:00:00Z&end=2024-01-01T01:00:00Z",
      });

      expect(result).toContain(
        "# Continuous Profile 041bde57b9844e36b8b7e5734efae5f7",
      );
      expect(result).toContain("## Raw Sample Analysis");
    });

    it("rejects profile URLs outside the active constrained project", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: `https://my-org.sentry.io/explore/profiling/profile/frontend/${transactionProfileV1Fixture.profile_id}/flamegraph/`,
          },
          {
            ...baseContext,
            constraints: {
              organizationSlug: "my-org",
              projectSlug: "backend",
            },
          },
        ),
      ).rejects.toThrow(
        'Profile URL is outside the active project constraint. Expected project "backend" but got "frontend".',
      );
    });
  });

  // ─── URL mode: resource URLs with dedicated tool dispatch ─────────────────
  describe("URL mode — monitor, release, and replay resources", () => {
    it("delegates replay URL to get_replay_details", async () => {
      const result = await callHandler({
        url: `https://sentry-mcp-evals.sentry.io/replays/${replayDetailsFixture.id}/`,
      });
      expect(result).toContain(
        `# Replay ${replayDetailsFixture.id} in **sentry-mcp-evals**`,
      );
      expect(result).toContain("Clicked submit order");
    });

    it("dispatches monitor URL with a simple slug to get_monitor_details", async () => {
      mswServer.use(
        ...mockMonitorResource({
          organizationSlug: "my-org",
          monitorSlug: "daily-backup",
        }),
      );

      const result = await callHandler({
        url: "https://my-org.sentry.io/crons/daily-backup/",
      });
      expect(result).toContain("# Monitor daily-backup in **my-org**");
      expect(result).toContain(
        "[Open Monitor](https://my-org.sentry.io/crons/backend/daily-backup/)",
      );
    });

    it("dispatches monitor URL with project/slug path to get_monitor_details", async () => {
      mswServer.use(
        ...mockMonitorResource({
          organizationSlug: "my-org",
          monitorSlug: "my-monitor",
          projectSlug: "my-project",
        }),
      );

      const result = await callHandler({
        url: "https://my-org.sentry.io/crons/my-project/my-monitor/",
      });
      expect(result).toContain("# Monitor my-monitor in **my-org**");
      expect(result).toContain(
        "[Open Monitor](https://my-org.sentry.io/crons/my-project/my-monitor/)",
      );
    });

    it("dispatches monitor URL with numeric project ID under an active project constraint", async () => {
      mswServer.use(
        ...mockMonitorResource({
          organizationSlug: "my-org",
          monitorSlug: "my-monitor",
          projectPath: "4509109104082945",
          projectSlug: "backend",
        }),
      );

      const result = await getSentryResource.handler(
        {
          url: "https://my-org.sentry.io/crons/4509109104082945/my-monitor/",
        },
        {
          ...baseContext,
          constraints: {
            ...baseContext.constraints,
            projectSlug: "backend",
          },
        },
      );

      expect(result).toContain("# Monitor my-monitor in **my-org**");
      expect(result).toContain(
        "[Open Monitor](https://my-org.sentry.io/crons/backend/my-monitor/)",
      );
    });

    it("rejects numeric monitor project IDs outside the active project constraint before monitor reads", async () => {
      const paths: string[] = [];
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/projects/my-org/frontend/",
          ({ request }) => {
            paths.push(new URL(request.url).pathname);
            return HttpResponse.json({
              id: "999",
              slug: "frontend",
              name: "frontend",
            });
          },
        ),
        http.get(
          "https://sentry.io/api/0/projects/my-org/4509109104082945/monitors/my-monitor/",
          ({ request }) => {
            paths.push(new URL(request.url).pathname);
            return HttpResponse.json({
              id: "123",
              slug: "my-monitor",
              project: {
                id: "4509109104082945",
                slug: "backend",
                name: "backend",
              },
            });
          },
        ),
      );

      await expect(
        getSentryResource.handler(
          {
            url: "https://my-org.sentry.io/crons/4509109104082945/my-monitor/",
          },
          {
            ...baseContext,
            constraints: {
              ...baseContext.constraints,
              projectSlug: "frontend",
            },
          },
        ),
      ).rejects.toThrow(
        'Monitor is outside the active project constraint. Expected project "frontend".',
      );
      expect(paths).toEqual(["/api/0/projects/my-org/frontend/"]);
    });

    it("dispatches explicit monitor resourceType under an active project constraint", async () => {
      mswServer.use(
        ...mockMonitorResource({
          organizationSlug: "my-org",
          monitorSlug: "my-monitor",
          projectSlug: "backend",
        }),
      );

      const result = await getSentryResource.handler(
        {
          resourceType: "monitor",
          resourceId: "my-monitor",
          organizationSlug: "my-org",
        },
        {
          ...baseContext,
          constraints: {
            ...baseContext.constraints,
            projectSlug: "backend",
          },
        },
      );

      expect(result).toContain("# Monitor my-monitor in **my-org**");
      expect(result).toContain(
        "[Open Monitor](https://my-org.sentry.io/crons/backend/my-monitor/)",
      );
    });

    it("dispatches release URL to get_release_details", async () => {
      mswServer.use(
        ...mockReleaseResource({
          organizationSlug: "my-org",
          releaseVersion: "v1.2.3",
        }),
      );

      const result = await callHandler({
        url: "https://my-org.sentry.io/releases/v1.2.3/",
      });
      expect(result).toContain("# Release v1.2.3 in **my-org**");
      expect(result).toContain(
        "[Open Release](https://my-org.sentry.io/releases/v1.2.3/)",
      );
    });

    it("dispatches release URL with complex version to get_release_details", async () => {
      mswServer.use(
        ...mockReleaseResource({
          organizationSlug: "my-org",
          releaseVersion: "backend@2024.01.15-abc123",
        }),
      );

      const result = await callHandler({
        url: "https://my-org.sentry.io/releases/backend@2024.01.15-abc123/",
      });
      expect(result).toContain(
        "# Release backend@2024.01.15-abc123 in **my-org**",
      );
      expect(result).toContain(
        "[Open Release](https://my-org.sentry.io/releases/backend%402024.01.15-abc123/)",
      );
    });

    it("dispatches encoded release URLs without double-encoding the version", async () => {
      mswServer.use(
        ...mockReleaseResource({
          organizationSlug: "my-org",
          releaseVersion: "backend/v1.2.3",
        }),
      );

      const result = await callHandler({
        url: "https://my-org.sentry.io/releases/backend%2Fv1.2.3/",
      });
      expect(result).toContain("# Release backend/v1.2.3 in **my-org**");
      expect(result).toContain(
        "[Open Release](https://my-org.sentry.io/releases/backend%2Fv1.2.3/)",
      );
    });

    it("uses configured host and protocol for self-hosted monitor URL", async () => {
      mswServer.use(
        ...mockMonitorResource({
          apiBaseUrl: "http://sentry.internal:9000",
          organizationSlug: "my-org",
          monitorSlug: "daily-backup",
        }),
      );

      const result = await getSentryResource.handler(
        {
          resourceType: undefined,
          resourceId: undefined,
          organizationSlug: undefined,
          url: "http://sentry.internal:9000/organizations/my-org/crons/daily-backup/",
        },
        {
          ...baseContext,
          sentryHost: "sentry.internal:9000",
          sentryProtocol: "http",
        },
      );
      expect(result).toContain(
        "[Open Monitor](http://sentry.internal:9000/organizations/my-org/crons/backend/daily-backup/)",
      );
    });

    it("uses configured host and protocol for self-hosted release URL", async () => {
      mswServer.use(
        ...mockReleaseResource({
          apiBaseUrl: "http://sentry.internal:9000",
          organizationSlug: "my-org",
          releaseVersion: "v1.2.3",
        }),
      );

      const result = await getSentryResource.handler(
        {
          resourceType: undefined,
          resourceId: undefined,
          organizationSlug: undefined,
          url: "http://sentry.internal:9000/organizations/my-org/releases/v1.2.3/",
        },
        {
          ...baseContext,
          sentryHost: "sentry.internal:9000",
          sentryProtocol: "http",
        },
      );
      expect(result).toContain(
        "[Open Release](http://sentry.internal:9000/organizations/my-org/releases/v1.2.3/)",
      );
    });
  });

  // ─── URL mode: error cases ────────────────────────────────────────────────
  describe("URL mode — error cases", () => {
    it("throws for unsupported URL path (settings)", async () => {
      await expect(
        callHandler({
          url: "https://sentry-mcp-evals.sentry.io/settings/projects/",
        }),
      ).rejects.toThrow("Could not determine resource type from URL");
    });

    it("throws helpful error for performance summary URL with transaction", async () => {
      await expect(
        callHandler({
          url: "https://my-org.sentry.io/performance/summary/?transaction=/api/users",
        }),
      ).rejects.toThrow(
        'Detected a performance summary URL for transaction "/api/users"',
      );
    });

    it("throws helpful error for encoded transaction names", async () => {
      await expect(
        callHandler({
          url: "https://my-org.sentry.io/performance/summary/?transaction=%2Fapi%2F0%2Forganizations",
        }),
      ).rejects.toThrow("Detected a performance summary URL for transaction");
    });
  });

  // ─── URL mode with resourceType override ──────────────────────────────────
  describe("URL mode with resourceType override", () => {
    it("fetches breadcrumbs from issue URL", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
        resourceType: "breadcrumbs",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
      expect(result).toContain("**Total Breadcrumbs**: 4");
      expect(result).toContain("fetch");
      expect(result).toContain("console");
      expect(result).toContain("navigation");
    });

    it("rejects breadcrumbs outside the active project constraint", async () => {
      await expect(
        getSentryResource.handler(
          {
            url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
            resourceType: "breadcrumbs",
          },
          {
            ...baseContext,
            constraints: {
              organizationSlug: "sentry-mcp-evals",
              projectSlug: "frontend",
            },
          },
        ),
      ).rejects.toThrow(
        'Issue is outside the active project constraint. Expected project "frontend".',
      );
    });

    it("fetches breadcrumbs from event URL (extracts issueId)", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41/events/7ca573c0f4814912aaa9bdc77d1a7d51",
        resourceType: "breadcrumbs",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
    });

    it("fetches breadcrumbs from path-based org URL", async () => {
      const result = await callHandler({
        url: "https://sentry.io/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
        resourceType: "breadcrumbs",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
    });

    it("same resourceType as detected type just passes through (issue)", async () => {
      const result = await callHandler({
        url: "https://sentry-mcp-evals.sentry.io/issues/CLOUDFLARE-MCP-41",
        resourceType: "issue",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    }, 10000);

    it("rejects unsupported override (issue on trace URL)", async () => {
      await expect(
        callHandler({
          url: "https://test-org.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a",
          resourceType: "issue",
        }),
      ).rejects.toThrow("Cannot override URL type with resourceType 'issue'");
    });

    it("rejects breadcrumbs override on non-issue URL (trace)", async () => {
      await expect(
        callHandler({
          url: "https://test-org.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a",
          resourceType: "breadcrumbs",
        }),
      ).rejects.toThrow("Could not extract issue ID from URL for breadcrumbs");
    });

    it("rejects span override on a plain trace URL", async () => {
      await expect(
        callHandler({
          url: "https://test-org.sentry.io/explore/traces/trace/a4d1aae7216b47ff8117cf4e09ce9d0a",
          resourceType: "span",
        }),
      ).rejects.toThrow(
        "Could not extract span ID from URL for span resource.",
      );
    });
  });

  // ─── By type and ID ─────────────────────────────────────────────────────────
  describe("By type and ID", () => {
    it("fetches issue by shortId", async () => {
      const result = await callHandler({
        resourceType: "issue",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("uppercases issue resourceId", async () => {
      const result = await callHandler({
        resourceType: "issue",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "cloudflare-mcp-41",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
    });

    it("fetches event by eventId", async () => {
      const result = await callHandler({
        resourceType: "event",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "7ca573c0f4814912aaa9bdc77d1a7d51",
      });
      expect(result).toContain(
        "# Issue CLOUDFLARE-MCP-41 in **sentry-mcp-evals**",
      );
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
      expect(result).toContain("**user.geo**: US, United States");
    });

    it("fetches trace by traceId", async () => {
      const traceId = "a4d1aae7216b47ff8117cf4e09ce9d0a";

      mswServer.use(
        mockOrganization("test-org"),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace-meta/${traceId}/`,
          () => HttpResponse.json(traceMetaFixture),
          { once: true },
        ),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace/${traceId}/`,
          () => HttpResponse.json(traceFixture),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "trace",
        organizationSlug: "test-org",
        resourceId: traceId,
      });
      expect(result).toContain(`# Trace \`${traceId}\` in **test-org**`);
      expect(result).toContain("**Total Spans**: 112");
      expect(result).toContain("**Errors**: 0");
    });

    it("fetches span by traceId:spanId", async () => {
      const traceId = "a4d1aae7216b47ff8117cf4e09ce9d0a";

      mswServer.use(
        mockOrganization("test-org"),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace-meta/${traceId}/`,
          () => HttpResponse.json(traceMetaFixture),
          { once: true },
        ),
        http.get(
          `https://sentry.io/api/0/organizations/test-org/trace/${traceId}/`,
          () => HttpResponse.json(traceFixture),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "span",
        organizationSlug: "test-org",
        resourceId: `${traceId}:aa8e7f3343113fbf`,
      });
      expect(result).toContain(
        "# Span `aa8e7f3343113fbf` in Trace `a4d1aae7216b47ff8117cf4e09ce9d0a` in **test-org**",
      );
    });

    it("fetches breadcrumbs by issueId", async () => {
      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
      expect(result).toContain(
        "**Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51",
      );
      expect(result).toContain("**Total Breadcrumbs**: 4");
      expect(result).toContain("[fetch]");
      expect(result).toContain("[navigation]");
    });

    it("uppercases breadcrumbs resourceId", async () => {
      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "cloudflare-mcp-41",
      });
      expect(result).toContain("# Breadcrumbs for CLOUDFLARE-MCP-41");
    });

    it("fetches replay by replayId", async () => {
      const result = await callHandler({
        resourceType: "replay",
        organizationSlug: "sentry-mcp-evals",
        resourceId: replayDetailsFixture.id,
      });
      expect(result).toContain(
        `# Replay ${replayDetailsFixture.id} in **sentry-mcp-evals**`,
      );
      expect(result).toContain("Clicked submit order");
    });

    it("fetches snapshot by snapshot ID", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/55/",
          ({ request }) => {
            const url = new URL(request.url);
            expect(url.searchParams.get("compact_metadata")).toBe("true");
            return HttpResponse.json({
              comparison_type: "diff",
              state: "visible",
              project_id: "1",
              images: [],
              changed: [],
              added: [],
              removed: [],
              renamed: [],
              errored: [],
              total_count: 0,
              changed_count: 0,
              added_count: 0,
              removed_count: 0,
              renamed_count: 0,
              unchanged_count: 0,
              errored_count: 0,
              skipped_count: 0,
            });
          },
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "snapshot",
        organizationSlug: "sentry",
        resourceId: "55",
      });
      expect(result).toContain("# Snapshot 55 in **sentry**");
      expect(result).toContain(
        "**URL**: https://sentry.sentry.io/preprod/snapshots/55/",
      );
      expect(result).toContain("**Images**: 0 total");
      expect(result).toContain(
        'get_sentry_resource(resourceType="snapshotImage", resourceId="55:<image_file_name>")',
      );
      expect(result).toContain(
        "- Full-resolution snapshot image bytes are not available in this session",
      );
      expect(result).not.toContain("?selectedSnapshot=");
    });

    it("fetches snapshot by URL and preserves no-diff image inventory compatibility", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/55/",
          () =>
            HttpResponse.json({
              comparison_type: "diff",
              state: "visible",
              images: [
                {
                  display_name: "No Change Login",
                  group: "auth",
                  image_file_name: "snapshots-iphone-16/no_change_login.png",
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
            }),
          { once: true },
        ),
      );

      const result = await callHandler({
        url: "https://sentry.sentry.io/preprod/snapshots/55/",
      });

      expect(result).toContain("# Snapshot 55 in **sentry**");
      expect(result).toContain("**Snapshot Images:**");
      expect(result).toContain("no_change_login.png — No Change Login — auth");
      expect(result).toContain(
        'get_sentry_resource(url="https://sentry.sentry.io/preprod/snapshots/55/?selectedSnapshot=<image_file_name>")',
      );
    });

    it("fetches snapshot image by snapshot URL selectedSnapshot query", async () => {
      const validPng = encodePng({
        width: 1,
        height: 1,
        data: new Uint8Array([255, 0, 0, 255]),
        depth: 8,
        channels: 4,
      });

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/55/images/login_screen.png/",
          () =>
            HttpResponse.json({
              image_file_name: "login_screen.png",
              comparison_status: "added",
              head_image: {
                image_file_name: "login_screen.png",
                image_url:
                  "/api/0/organizations/sentry/preprodartifacts/snapshots/55/images/head.png/download/",
              },
              base_image: null,
              diff_image_url: null,
            }),
          { once: true },
        ),
        http.get(
          "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/55/images/head.png/download/",
          () =>
            new HttpResponse(validPng, {
              headers: { "Content-Type": "image/png" },
            }),
          { once: true },
        ),
      );

      const result = await callHandler({
        url: "https://sentry.sentry.io/preprod/snapshots/55/?selectedSnapshot=login_screen.png",
      });

      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) {
        throw new Error("Expected snapshot image result parts");
      }
      expect(result[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("**Image Resolution**: preview"),
      });
      expect(result[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining(
          "Full-resolution snapshot image bytes are not available in this session",
        ),
      });
    });

    it("fetches snapshot image by snapshot ID and image file name", async () => {
      const imageFileName =
        "snapshots-iphone-17e/test_CoffeeProductCards.swift_FeaturedProductCard_Kenya.png";
      const validPng = encodePng({
        width: 1,
        height: 1,
        data: new Uint8Array([255, 0, 0, 255]),
        depth: 8,
        channels: 4,
      });

      mswServer.use(
        http.get(
          `https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/55/images/${encodeURIComponent(imageFileName)}/`,
          () =>
            HttpResponse.json({
              image_file_name: imageFileName,
              comparison_status: "changed",
              diff_percentage: 0.125,
              head_image: {
                image_file_name: imageFileName,
                display_name: "FeaturedProductCard / Kenya",
                group: "test/CoffeeProductCards.swift",
                width: 1320,
                height: 2868,
                image_url:
                  "/api/0/organizations/sentry/preprodartifacts/snapshots/55/images/head.png/download/",
              },
              base_image: null,
              diff_image_url: null,
            }),
          { once: true },
        ),
        http.get(
          "https://sentry.io/api/0/organizations/sentry/preprodartifacts/snapshots/55/images/head.png/download/",
          () =>
            new HttpResponse(validPng, {
              headers: { "Content-Type": "image/png" },
            }),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "snapshotImage",
        organizationSlug: "sentry",
        resourceId: `55:${imageFileName}`,
      });
      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) {
        throw new Error("Expected snapshot image result parts");
      }
      expect(result[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining(`## ${imageFileName}`),
      });
      expect(result[0]).toMatchObject({
        text: expect.stringContaining("- **Status**: changed"),
      });
      expect(result[0]).toMatchObject({
        text: expect.stringContaining(`- **File**: \`${imageFileName}\``),
      });
      expect(result[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("**Image Resolution**: preview"),
      });
      expect(result[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining(
          "- **Full Resolution**: Full-resolution snapshot image bytes are not available in this session",
        ),
      });
      expect(result).toContainEqual(
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
      );
    });
  });

  // ─── Breadcrumbs output formatting ────────────────────────────────────────
  describe("Breadcrumbs output formatting", () => {
    it("formats breadcrumbs with table, data section, and usage hints", async () => {
      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Breadcrumbs for CLOUDFLARE-MCP-41

        **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51
        **Total Breadcrumbs**: 4

        \`\`\`
        2025-04-08T21:14:50.000Z info    [fetch] GET /api/0/organizations/ [200] {"method":"GET","url":"/api/0/organizations/","status_code":200}
        2025-04-08T21:14:52.000Z warning [console] Deprecation warning: use v2 endpoint
        2025-04-08T21:14:55.000Z info    [navigation] {"from":"/dashboard","to":"/settings"}
        2025-04-08T21:15:04.000Z error   [console] Tool list_organizations is already registered
        \`\`\`

        Breadcrumbs show the trail of events leading up to the error, in chronological order.
        Use \`get_sentry_resource(resourceType='issue', organizationSlug='...', resourceId='CLOUDFLARE-MCP-41')\` for full issue details."
      `);
    });

    it("handles event with no breadcrumbs gracefully", async () => {
      const eventNoBreadcrumbs = {
        ...eventFixture,
        entries: eventFixture.entries.filter(
          (e: { type: string }) => e.type !== "breadcrumbs",
        ),
      };

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/latest/",
          () => HttpResponse.json(eventNoBreadcrumbs),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Breadcrumbs for CLOUDFLARE-MCP-41

        **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51

        No breadcrumbs found in the latest event for this issue."
      `);
    });

    it("handles event with empty breadcrumbs array", async () => {
      const eventEmptyBreadcrumbs = {
        ...eventFixture,
        entries: [
          ...eventFixture.entries.filter(
            (e: { type: string }) => e.type !== "breadcrumbs",
          ),
          { type: "breadcrumbs", data: { values: [] } },
        ],
      };

      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/latest/",
          () => HttpResponse.json(eventEmptyBreadcrumbs),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "breadcrumbs",
        organizationSlug: "sentry-mcp-evals",
        resourceId: "CLOUDFLARE-MCP-41",
      });
      expect(result).toMatchInlineSnapshot(`
        "# Breadcrumbs for CLOUDFLARE-MCP-41

        **Event ID**: 7ca573c0f4814912aaa9bdc77d1a7d51

        No breadcrumbs found in the latest event for this issue."
      `);
    });
  });

  // ─── Validation errors ────────────────────────────────────────────────────
  describe("Validation errors", () => {
    it("throws when neither url nor resourceType provided", async () => {
      await expect(
        callHandler({ organizationSlug: "my-org", resourceId: "X-1" }),
      ).rejects.toThrow("Either `url` or `resourceType` must be provided");
    });

    it("throws when organizationSlug missing for explicit mode", async () => {
      await expect(
        callHandler({ resourceType: "issue", resourceId: "PROJECT-123" }),
      ).rejects.toThrow("`organizationSlug` is required when not using a URL");
    });

    it("throws when resourceId missing for issue type", async () => {
      await expect(
        callHandler({
          resourceType: "issue",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow("`resourceId` is required when not using a URL");
    });

    it("throws when resourceId missing for event type", async () => {
      await expect(
        callHandler({
          resourceType: "event",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow("`resourceId` is required when not using a URL");
    });

    it("throws when resourceId missing for trace type", async () => {
      await expect(
        callHandler({
          resourceType: "trace",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow("`resourceId` is required when not using a URL");
    });

    it("throws when resourceId missing for span type", async () => {
      await expect(
        callHandler({
          resourceType: "span",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow("`resourceId` is required when not using a URL");
    });

    it("throws when resourceId missing for breadcrumbs type", async () => {
      await expect(
        callHandler({
          resourceType: "breadcrumbs",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow("`resourceId` is required when not using a URL");
    });

    it("throws when resourceId missing for snapshot type", async () => {
      await expect(
        callHandler({
          resourceType: "snapshot",
          organizationSlug: "my-org",
        }),
      ).rejects.toThrow("`resourceId` is required when not using a URL");
    });

    it("throws when snapshot image resourceId is missing the file name", async () => {
      await expect(
        callHandler({
          resourceType: "snapshotImage",
          organizationSlug: "my-org",
          resourceId: "55",
        }),
      ).rejects.toThrow(
        "Snapshot image resourceId must use the format `<snapshotId>:<image_file_name>`.",
      );
    });

    it("throws for unsupported explicit resourceType (profile)", async () => {
      await expect(
        callHandler({
          resourceType: "profile" as "issue",
          organizationSlug: "my-org",
          resourceId: "something",
        }),
      ).rejects.toThrow("Invalid resourceType: profile");
    });

    it("accepts replay as explicit resourceType", async () => {
      mswServer.use(
        http.get(
          "https://sentry.io/api/0/organizations/my-org/",
          () =>
            HttpResponse.json({
              ...organizationFixture,
              slug: "my-org",
              links: {
                ...organizationFixture.links,
                regionUrl: "https://us.sentry.io",
                organizationUrl: "https://my-org.sentry.io",
              },
            }),
          { once: true },
        ),
        http.get(
          "https://us.sentry.io/api/0/organizations/my-org/replays/something/",
          () =>
            HttpResponse.json({
              data: {
                id: "something",
                project_id: "123",
                started_at: "2025-04-07T12:00:00.000Z",
                finished_at: "2025-04-07T12:05:00.000Z",
                duration: 300,
                is_archived: true,
                count_segments: 0,
                count_errors: 0,
                count_warnings: 0,
                count_infos: 0,
                count_dead_clicks: 0,
                count_rage_clicks: 0,
                count_urls: 0,
                urls: [],
                trace_ids: [],
                error_ids: [],
                browser: {},
                os: {},
                device: {},
                sdk: {},
                user: {},
              },
            }),
          { once: true },
        ),
      );

      const result = await callHandler({
        resourceType: "replay",
        organizationSlug: "my-org",
        resourceId: "something",
      });
      expect(result).toContain("# Replay something in **my-org**");
    });
  });

  // ─── Tool metadata ────────────────────────────────────────────────────────
  describe("Tool metadata", () => {
    it("is stable by default", () => {
      expect(getSentryResource.experimental).toBeUndefined();
    });

    it("has read-only annotation", () => {
      expect(getSentryResource.annotations.readOnlyHint).toBe(true);
    });

    it("belongs to inspect skill", () => {
      expect(getSentryResource.skills).toContain("inspect");
    });

    it("exposes the expected input schema", () => {
      const schemaKeys = Object.keys(getSentryResource.inputSchema);
      expect(schemaKeys).toEqual([
        "url",
        "resourceType",
        "resourceId",
        "organizationSlug",
      ]);
    });
  });
});
