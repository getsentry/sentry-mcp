import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const IssueLatestEventPayload = {
  id: "7ca573c0f4814912aaa9bdc77d1a7d51",
  groupID: "6507376925",
  eventID: "7ca573c0f4814912aaa9bdc77d1a7d51",
  projectID: "4509062593708032",
  size: 5891,
  entries: [
    {
      data: {
        values: [
          {
            type: "Error",
            value: "Tool list_organizations is already registered",
            mechanism: { type: "cloudflare", handled: false },
            threadId: null,
            module: null,
            stacktrace: {
              frames: [
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: null,
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 7809,
                  colNo: 27,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "OAuthProviderImpl.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 8029,
                  colNo: 24,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "Object.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 19631,
                  colNo: 28,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
              ],
              framesOmitted: null,
              registers: null,
              hasSystemFrames: true,
            },
            rawStacktrace: {
              frames: [
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: null,
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 7809,
                  colNo: 27,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "OAuthProviderImpl.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 8029,
                  colNo: 24,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
                {
                  filename: "index.js",
                  absPath: "/index.js",
                  module: "index",
                  package: null,
                  platform: null,
                  instructionAddr: null,
                  symbolAddr: null,
                  function: "Object.fetch",
                  rawFunction: null,
                  symbol: null,
                  context: [],
                  lineNo: 19631,
                  colNo: 28,
                  inApp: true,
                  trust: null,
                  errors: null,
                  lock: null,
                  sourceLink: null,
                  vars: null,
                },
              ],
              framesOmitted: null,
              registers: null,
              hasSystemFrames: true,
            },
          },
        ],
        hasSystemFrames: true,
        excOmitted: null,
      },
      type: "exception",
    },
    {
      data: {
        apiTarget: null,
        method: "GET",
        url: "https://mcp.sentry.dev/sse",
        query: [],
        fragment: null,
        data: null,
        headers: [
          ["Accept", "text/event-stream"],
          ["Accept-Encoding", "gzip, br"],
          ["Accept-Language", "*"],
          ["Authorization", "[Filtered]"],
          ["Cache-Control", "no-cache"],
          ["Cf-Ipcountry", "GB"],
          ["Cf-Ray", "92d4c7266c8f48c9"],
          ["Cf-Visitor", '{"scheme":"https"}'],
          ["Connection", "Keep-Alive"],
          ["Host", "mcp.sentry.dev"],
          ["Pragma", "no-cache"],
          ["Sec-Fetch-Mode", "cors"],
          ["User-Agent", "node"],
          ["X-Forwarded-Proto", "https"],
        ],
        cookies: [],
        env: null,
        inferredContentType: null,
      },
      type: "request",
    },
  ],
  dist: null,
  message: "",
  title: "Error: Tool list_organizations is already registered",
  location: "index.js",
  user: {
    id: null,
    email: null,
    username: null,
    ip_address: "2a06:98c0:3600::103",
    name: null,
    geo: { country_code: "US", region: "United States" },
    data: null,
  },
  contexts: {
    cloud_resource: { "cloud.provider": "cloudflare", type: "default" },
    culture: { timezone: "Europe/London", type: "default" },
    runtime: { name: "cloudflare", type: "runtime" },
    trace: {
      trace_id: "3032af8bcdfe4423b937fc5c041d5d82",
      span_id: "953da703d2a6f4c7",
      status: "unknown",
      client_sample_rate: 1.0,
      sampled: true,
      type: "trace",
    },
  },
  sdk: { name: "sentry.javascript.cloudflare", version: "9.12.0" },
  context: {},
  packages: {},
  type: "error",
  metadata: {
    filename: "index.js",
    function: "Object.fetch",
    in_app_frame_mix: "in-app-only",
    type: "Error",
    value: "Tool list_organizations is already registered",
  },
  tags: [
    { key: "environment", value: "development" },
    { key: "handled", value: "no" },
    { key: "level", value: "error" },
    { key: "mechanism", value: "cloudflare" },
    { key: "runtime.name", value: "cloudflare" },
    { key: "url", value: "https://mcp.sentry.dev/sse" },
  ],
  platform: "javascript",
  dateReceived: "2025-04-08T21:15:04.700878Z",
  errors: [
    {
      type: "js_no_source",
      message: "Source code was not found",
      data: { symbolicator_type: "missing_source", url: "/index.js" },
    },
  ],
  occurrence: null,
  _meta: {
    entries: {
      "1": {
        data: {
          "": null,
          apiTarget: null,
          method: null,
          url: null,
          query: null,
          data: null,
          headers: {
            "3": {
              "1": {
                "": {
                  rem: [["@password:filter", "s", 0, 10]],
                  len: 64,
                  chunks: [
                    {
                      type: "redaction",
                      text: "[Filtered]",
                      rule_id: "@password:filter",
                      remark: "s",
                    },
                  ],
                },
              },
            },
          },
          cookies: null,
          env: null,
        },
      },
    },
    message: null,
    user: null,
    contexts: null,
    sdk: null,
    context: null,
    packages: null,
    tags: {},
  },
  crashFile: null,
  culprit: "Object.fetch(index)",
  dateCreated: "2025-04-08T21:15:04Z",
  fingerprints: ["60d1c667b173018c004e399b29dc927d"],
  groupingConfig: {
    enhancements: "KLUv_SAYwQAAkwKRs25ld3N0eWxlOjIwMjMtMDEtMTGQ",
    id: "newstyle:2023-01-11",
  },
  release: null,
  userReport: null,
  sdkUpdates: [],
  resolvedWith: [null],
  nextEventID: null,
  previousEventID: "b7ed18493f4f4817a217b03839d4c017",
};

export const restHandlers = [
  http.get("https://sentry.io/api/0/organizations/", () => {
    return HttpResponse.json([
      {
        id: "4509106740723712",
        slug: "sentry-mcp-evals",
        name: "sentry-mcp-evals",
      },
    ]);
  }),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
    () => {
      return HttpResponse.json([
        {
          id: "4509106740854784",
          slug: "sentry-mcp-evals",
          name: "sentry-mcp-evals",
          dateCreated: "2025-04-06T14:11:23.961739Z",
          isMember: true,
          teamRole: "admin",
          flags: { "idp:provisioned": false },
          access: [
            "team:read",
            "alerts:read",
            "event:write",
            "team:write",
            "team:admin",
            "event:read",
            "org:read",
            "member:read",
            "project:admin",
            "project:write",
            "org:integrations",
            "project:releases",
            "alerts:write",
            "event:admin",
            "project:read",
          ],
          hasAccess: true,
          isPending: false,
          memberCount: 1,
          avatar: { avatarType: "letter_avatar", avatarUuid: null },
          externalTeams: [],
          projects: [],
        },
      ]);
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/projects/",
    () => {
      return HttpResponse.json([
        {
          team: {
            id: "4509106733776896",
            slug: "sentry-mcp-evals",
            name: "sentry-mcp-evals",
          },
          teams: [
            {
              id: "4509106733776896",
              slug: "sentry-mcp-evals",
              name: "sentry-mcp-evals",
            },
          ],
          id: "4509106749636608",
          name: "test-suite",
          slug: "test-suite",
          isBookmarked: false,
          isMember: true,
          access: [
            "event:admin",
            "alerts:read",
            "project:write",
            "org:integrations",
            "alerts:write",
            "member:read",
            "team:write",
            "project:read",
            "event:read",
            "event:write",
            "project:admin",
            "org:read",
            "team:admin",
            "project:releases",
            "team:read",
          ],
          hasAccess: true,
          dateCreated: "2025-04-06T14:13:37.825970Z",
          environments: [],
          eventProcessing: { symbolicationDegraded: false },
          features: [
            "discard-groups",
            "alert-filters",
            "similarity-embeddings",
            "similarity-indexing",
            "similarity-view",
          ],
          firstEvent: null,
          firstTransactionEvent: false,
          hasSessions: false,
          hasProfiles: false,
          hasReplays: false,
          hasFeedbacks: false,
          hasNewFeedbacks: false,
          hasMonitors: false,
          hasMinifiedStackTrace: false,
          hasInsightsHttp: false,
          hasInsightsDb: false,
          hasInsightsAssets: false,
          hasInsightsAppStart: false,
          hasInsightsScreenLoad: false,
          hasInsightsVitals: false,
          hasInsightsCaches: false,
          hasInsightsQueues: false,
          hasInsightsLlmMonitoring: false,
          platform: "node",
          platforms: [],
          latestRelease: null,
          hasUserReports: false,
          hasFlags: false,
          latestDeploys: null,
        },
      ]);
    },
  ),
  http.post(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/teams/",
    () => {
      // TODO: validate payload (only accept 'the-goats' for team name)
      return HttpResponse.json({
        id: "4509109078196224",
        slug: "the-goats",
        name: "the-goats",
        dateCreated: "2025-04-07T00:05:48.196710Z",
        isMember: true,
        teamRole: "admin",
        flags: { "idp:provisioned": false },
        access: [
          "event:read",
          "org:integrations",
          "org:read",
          "member:read",
          "alerts:write",
          "event:admin",
          "team:admin",
          "project:releases",
          "team:read",
          "project:write",
          "event:write",
          "team:write",
          "project:read",
          "project:admin",
          "alerts:read",
        ],
        hasAccess: true,
        isPending: false,
        memberCount: 1,
        avatar: { avatarType: "letter_avatar", avatarUuid: null },
      });
    },
  ),
  http.post(
    "https://sentry.io/api/0/teams/sentry-mcp-evals/the-goats/projects/",
    () => {
      // TODO: validate payload (only accept 'cloudflare-mcp' for project name)
      return HttpResponse.json({
        id: "4509109104082945",
        slug: "cloudflare-mcp",
        name: "cloudflare-mcp",
        platform: "javascript",
        dateCreated: "2025-04-07T00:12:23.143074Z",
        isBookmarked: false,
        isMember: true,
        features: [
          "discard-groups",
          "alert-filters",
          "similarity-embeddings",
          "similarity-indexing",
          "similarity-view",
        ],
        firstEvent: null,
        firstTransactionEvent: false,
        access: [
          "team:write",
          "alerts:write",
          "event:write",
          "org:read",
          "alerts:read",
          "event:admin",
          "project:admin",
          "event:read",
          "org:integrations",
          "project:read",
          "project:releases",
          "project:write",
          "member:read",
          "team:read",
          "team:admin",
        ],
        hasAccess: true,
        hasMinifiedStackTrace: false,
        hasMonitors: false,
        hasProfiles: false,
        hasReplays: false,
        hasFeedbacks: false,
        hasFlags: false,
        hasNewFeedbacks: false,
        hasSessions: false,
        hasInsightsHttp: false,
        hasInsightsDb: false,
        hasInsightsAssets: false,
        hasInsightsAppStart: false,
        hasInsightsScreenLoad: false,
        hasInsightsVitals: false,
        hasInsightsCaches: false,
        hasInsightsQueues: false,
        hasInsightsLlmMonitoring: false,
        isInternal: false,
        isPublic: false,
        avatar: { avatarType: "letter_avatar", avatarUuid: null },
        color: "#bf3f55",
        status: "active",
      });
    },
  ),
  http.post(
    "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/keys/",
    () => {
      // TODO: validate payload (only accept 'Default' for key name)
      return HttpResponse.json({
        id: "d20df0a1ab5031c7f3c7edca9c02814d",
        name: "Default",
        label: "Default",
        public: "d20df0a1ab5031c7f3c7edca9c02814d",
        secret: "154001fd3dfe38130e1c7948a323fad8",
        projectId: 4509109104082945,
        isActive: true,
        rateLimit: null,
        dsn: {
          secret:
            "https://d20df0a1ab5031c7f3c7edca9c02814d:154001fd3dfe38130e1c7948a323fad8@o4509106732793856.ingest.us.sentry.io/4509109104082945",
          public:
            "https://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945",
          csp: "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/csp-report/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
          security:
            "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/security/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
          minidump:
            "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/minidump/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
          nel: "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/nel/?sentry_key=d20df0a1ab5031c7f3c7edca9c02814d",
          unreal:
            "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/unreal/d20df0a1ab5031c7f3c7edca9c02814d/",
          crons:
            "https://o4509106732793856.ingest.us.sentry.io/api/4509109104082945/cron/___MONITOR_SLUG___/d20df0a1ab5031c7f3c7edca9c02814d/",
          cdn: "https://js.sentry-cdn.com/d20df0a1ab5031c7f3c7edca9c02814d.min.js",
        },
        browserSdkVersion: "8.x",
        browserSdk: {
          choices: [
            ["9.x", "9.x"],
            ["8.x", "8.x"],
            ["7.x", "7.x"],
          ],
        },
        dateCreated: "2025-04-07T00:12:25.139394Z",
        dynamicSdkLoaderOptions: {
          hasReplay: true,
          hasPerformance: true,
          hasDebug: false,
        },
      });
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/events/",
    async ({ request }) => {
      // why is url empty???
      // const url = new URL(request.url);
      // const dataset = url.searchParams.get("dataset");
      // const query = url.searchParams.get("query");
      // if (dataset !== "errors") {
      //   return HttpResponse.json("", { status: 400 });
      // }
      // if (query !== "errors") {
      //   return HttpResponse.json("", { status: 400 });
      // }
      return HttpResponse.json({
        data: [
          {
            "issue.id": 6114575469,
            title: "Error: Tool list_organizations is already registered",
            project: "test-suite",
            "count()": 2,
            "last_seen()": "2025-04-07T12:23:39+00:00",
            issue: "REMOTE-MCP-41",
          },
        ],
        meta: {
          fields: {
            "issue.id": "integer",
            title: "string",
            project: "string",
            "count()": "integer",
            "last_seen()": "date",
          },
          units: {
            "issue.id": null,
            title: null,
            project: null,
            "count()": null,
            "last_seen()": null,
          },
          isMetricsData: false,
          isMetricsExtractedData: false,
          tips: { query: null, columns: null },
          datasetReason: "unchanged",
          dataset: "errors",
        },
      });
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/REMOTE-MCP-41/events/latest/",
    () => {
      return HttpResponse.json(IssueLatestEventPayload);
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376925/events/latest/",
    () => {
      return HttpResponse.json(IssueLatestEventPayload);
    },
  ),
];

export const mswServer = setupServer(...restHandlers);
