import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const TagsPayload = [
  { key: "transaction", name: "Transaction", totalValues: 1080 },
  { key: "runtime.name", name: "Runtime.Name", totalValues: 1080 },
  { key: "level", name: "Level", totalValues: 1144 },
  { key: "device", name: "Device", totalValues: 25 },
  { key: "os", name: "OS", totalValues: 1133 },
  { key: "user", name: "User", totalValues: 1080 },
  { key: "runtime", name: "Runtime", totalValues: 1080 },
  { key: "release", name: "Release", totalValues: 1135 },
  { key: "url", name: "URL", totalValues: 1080 },
  { key: "uptime_rule", name: "Uptime Rule", totalValues: 9 },
  { key: "server_name", name: "Server", totalValues: 1080 },
  { key: "browser", name: "Browser", totalValues: 56 },
  { key: "os.name", name: "Os.Name", totalValues: 1135 },
  { key: "device.family", name: "Device.Family", totalValues: 25 },
  { key: "replayId", name: "Replayid", totalValues: 55 },
  { key: "client_os.name", name: "Client Os.Name", totalValues: 1 },
  { key: "environment", name: "Environment", totalValues: 1144 },
  { key: "service", name: "Service", totalValues: 1135 },
  { key: "browser.name", name: "Browser.Name", totalValues: 56 },
];

const ReleasePayload = {
  id: 1402755016,
  version: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
  status: "open",
  shortVersion: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
  versionInfo: {
    package: null,
    version: { raw: "8ce89484-0fec-4913-a2cd-e8e2d41dee36" },
    description: "8ce89484-0fec-4913-a2cd-e8e2d41dee36",
    buildHash: null,
  },
  ref: null,
  url: null,
  dateReleased: null,
  dateCreated: "2025-04-13T19:54:21.764000Z",
  data: {},
  newGroups: 0,
  owner: null,
  commitCount: 0,
  lastCommit: null,
  deployCount: 0,
  lastDeploy: null,
  authors: [],
  projects: [
    {
      id: 4509062593708032,
      slug: "cloudflare-mcp",
      name: "cloudflare-mcp",
      newGroups: 0,
      platform: "bun",
      platforms: ["javascript"],
      hasHealthData: false,
    },
  ],
  firstEvent: "2025-04-13T19:54:21Z",
  lastEvent: "2025-04-13T20:28:23Z",
  currentProjectMeta: {},
  userAgent: null,
};

const IssuePayload = {
  id: "6507376925",
  shareId: null,
  shortId: "CLOUDFLARE-MCP-41",
  title: "Error: Tool list_organizations is already registered",
  culprit: "Object.fetch(index)",
  permalink: "https://sentry-mcp-evals.sentry.io/issues/6507376925/",
  logger: null,
  level: "error",
  status: "unresolved",
  statusDetails: {},
  substatus: "ongoing",
  isPublic: false,
  platform: "javascript",
  project: {
    id: "4509062593708032",
    name: "CLOUDFLARE-MCP",
    slug: "CLOUDFLARE-MCP",
    platform: "bun",
  },
  type: "error",
  metadata: {
    value: "Tool list_organizations is already registered",
    type: "Error",
    filename: "index.js",
    function: "Object.fetch",
    in_app_frame_mix: "in-app-only",
    sdk: {
      name: "sentry.javascript.cloudflare",
      name_normalized: "sentry.javascript.cloudflare",
    },
    severity: 0.0,
    severity_reason: "ml",
    initial_priority: 50,
    title: null,
  },
  numComments: 0,
  assignedTo: null,
  isBookmarked: false,
  isSubscribed: false,
  subscriptionDetails: null,
  hasSeen: true,
  annotations: [],
  issueType: "error",
  issueCategory: "error",
  priority: "medium",
  priorityLockedAt: null,
  isUnhandled: true,
  count: "25",
  userCount: 1,
  firstSeen: "2025-04-03T22:51:19.403000Z",
  lastSeen: "2025-04-12T11:34:11Z",
  firstRelease: null,
  lastRelease: null,
  tags: [
    { key: "environment", name: "Environment", totalValues: 25 },
    { key: "handled", name: "Handled", totalValues: 25 },
    { key: "level", name: "Level", totalValues: 25 },
    { key: "mechanism", name: "Mechanism", totalValues: 25 },
    { key: "runtime.name", name: "Runtime.Name", totalValues: 25 },
    { key: "url", name: "URL", totalValues: 25 },
    { key: "user", name: "User", totalValues: 25 },
  ],
  activity: [
    {
      id: "4633815464",
      user: null,
      type: "auto_set_ongoing",
      data: { after_days: 7 },
      dateCreated: "2025-04-10T22:55:22.411699Z",
    },
    {
      id: "0",
      user: null,
      type: "first_seen",
      data: { priority: "medium" },
      dateCreated: "2025-04-03T22:51:19.403000Z",
    },
  ],
  openPeriods: [
    {
      start: "2025-04-03T22:51:19.403000Z",
      end: null,
      duration: null,
      isOpen: true,
      lastChecked: "2025-04-12T11:34:11.310000Z",
    },
  ],
  seenBy: [
    {
      id: "1",
      name: "David Cramer",
      username: "david@example.com",
      email: "david@example.com",
      avatarUrl: null,
      isActive: true,
      hasPasswordAuth: true,
      isManaged: false,
      dateJoined: "2012-01-14T22:08:29.270831Z",
      lastLogin: "2025-04-13T14:00:11.516852Z",
      has2fa: true,
      lastActive: "2025-04-13T18:10:49.177605Z",
      isSuperuser: true,
      isStaff: true,
      experiments: {},
      emails: [{ id: "87429", email: "david@example.com", is_verified: true }],
      options: {
        theme: "light",
        language: "en",
        stacktraceOrder: 2,
        defaultIssueEvent: "recommended",
        timezone: "US/Pacific",
        clock24Hours: false,
      },
      flags: { newsletter_consent_prompt: false },
      avatar: {
        avatarType: "upload",
        avatarUuid: "51e63edabf31412aa2a955e9cf2c1ca0",
        avatarUrl: "https://sentry.io/avatar/51e63edabf31412aa2a955e9cf2c1ca0/",
      },
      identities: [],
      lastSeen: "2025-04-08T23:15:26.569455Z",
    },
  ],
  pluginActions: [],
  pluginIssues: [],
  pluginContexts: [],
  userReportCount: 0,
  stats: {
    "24h": [
      [1744480800, 0],
      [1744484400, 0],
      [1744488000, 0],
      [1744491600, 0],
      [1744495200, 0],
      [1744498800, 0],
      [1744502400, 0],
      [1744506000, 0],
      [1744509600, 0],
      [1744513200, 0],
      [1744516800, 0],
      [1744520400, 0],
      [1744524000, 0],
      [1744527600, 0],
      [1744531200, 0],
      [1744534800, 0],
      [1744538400, 0],
      [1744542000, 0],
      [1744545600, 0],
      [1744549200, 0],
      [1744552800, 0],
      [1744556400, 0],
      [1744560000, 0],
      [1744563600, 0],
      [1744567200, 0],
    ],
    "30d": [
      [1741910400, 0],
      [1741996800, 0],
      [1742083200, 0],
      [1742169600, 0],
      [1742256000, 0],
      [1742342400, 0],
      [1742428800, 0],
      [1742515200, 0],
      [1742601600, 0],
      [1742688000, 0],
      [1742774400, 0],
      [1742860800, 0],
      [1742947200, 0],
      [1743033600, 0],
      [1743120000, 0],
      [1743206400, 0],
      [1743292800, 0],
      [1743379200, 0],
      [1743465600, 0],
      [1743552000, 0],
      [1743638400, 1],
      [1743724800, 0],
      [1743811200, 0],
      [1743897600, 0],
      [1743984000, 0],
      [1744070400, 20],
      [1744156800, 1],
      [1744243200, 1],
      [1744329600, 0],
      [1744416000, 2],
      [1744502400, 0],
    ],
  },
  participants: [],
};

// a newer issue, seen less recently
const IssuePayload2 = {
  ...IssuePayload,
  id: 6507376926,
  shortId: "CLOUDFLARE-MCP-42",
  count: 1,
  title: "Error: Tool list_issues is already registered",
  firstSeen: "2025-04-11T22:51:19.403000Z",
  lastSeen: "2025-04-12T11:34:11Z",
};

const EventPayload = {
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

const EventsErrorsMeta = {
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
};

const EmptyEventsErrorsPayload = {
  data: [],
  meta: EventsErrorsMeta,
};

const EventsErrorsPayload = {
  data: [
    {
      "issue.id": 6114575469,
      title: "Error: Tool list_organizations is already registered",
      project: "test-suite",
      "count()": 2,
      "last_seen()": "2025-04-07T12:23:39+00:00",
      issue: "CLOUDFLARE-MCP-41",
    },
  ],
  meta: EventsErrorsMeta,
};

const EventsSpansMeta = {
  fields: {
    id: "string",
    "span.op": "string",
    "span.description": "string",
    "span.duration": "duration",
    transaction: "string",
    timestamp: "string",
    is_transaction: "boolean",
    project: "string",
    trace: "string",
    "transaction.span_id": "string",
    "project.name": "string",
  },
  units: {
    id: null,
    "span.op": null,
    "span.description": null,
    "span.duration": "millisecond",
    transaction: null,
    timestamp: null,
    is_transaction: null,
    project: null,
    trace: null,
    "transaction.span_id": null,
    "project.name": null,
  },
  isMetricsData: false,
  isMetricsExtractedData: false,
  tips: {},
  datasetReason: "unchanged",
  dataset: "spans",
  dataScanned: "full",
  accuracy: {
    confidence: [
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
    ],
  },
};

const EmptyEventsSpansPayload = {
  data: [],
  meta: EventsSpansMeta,
};

const EventsSpansPayload = {
  data: [
    {
      id: "07752c6aeb027c8f",
      "span.op": "http.server",
      "span.description": "GET /trpc/bottleList",
      "span.duration": 12.0,
      transaction: "GET /trpc/bottleList",
      timestamp: "2025-04-13T14:19:18+00:00",
      is_transaction: true,
      project: "peated",
      trace: "6a477f5b0f31ef7b6b9b5e1dea66c91d",
      "transaction.span_id": "07752c6aeb027c8f",
      "project.name": "peated",
    },
    {
      id: "7ab5edf5b3ba42c9",
      "span.op": "http.server",
      "span.description": "GET /trpc/bottleList",
      "span.duration": 18.0,
      transaction: "GET /trpc/bottleList",
      timestamp: "2025-04-13T14:19:17+00:00",
      is_transaction: true,
      project: "peated",
      trace: "54177131c7b192a446124daba3136045",
      "transaction.span_id": "7ab5edf5b3ba42c9",
      "project.name": "peated",
    },
  ],
  meta: EventsSpansMeta,
  confidence: [
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  ],
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
          slug: "the-goats",
          name: "the-goats",
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
            slug: "the-goats",
            name: "the-goats",
          },
          teams: [
            {
              id: "4509106733776896",
              slug: "the-goats",
              name: "the-goats",
            },
          ],
          id: "4509106749636608",
          name: "cloudflare-mcp",
          slug: "cloudflare-mcp",
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
      const url = new URL(request.url);
      const dataset = url.searchParams.get("dataset");
      const query = url.searchParams.get("query");
      const fields = url.searchParams.getAll("field");

      if (dataset === "spans") {
        //[sentryApi] GET https://sentry.io/api/0/organizations/sentry-mcp-evals/events/?dataset=spans&per_page=10&referrer=sentry-mcp&sort=-span.duration&allowAggregateConditions=0&useRpc=1&field=id&field=trace&field=span.op&field=span.description&field=span.duration&field=transaction&field=project&field=timestamp&query=is_transaction%3Atrue
        if (query !== "is_transaction:true") {
          return HttpResponse.json(EmptyEventsSpansPayload);
        }

        if (url.searchParams.get("useRpc") !== "1") {
          return HttpResponse.json("Invalid useRpc", { status: 400 });
        }

        if (
          !fields.includes("id") ||
          !fields.includes("trace") ||
          !fields.includes("span.op") ||
          !fields.includes("span.description") ||
          !fields.includes("span.duration")
        ) {
          return HttpResponse.json("Invalid fields", { status: 400 });
        }
        return HttpResponse.json(EventsSpansPayload);
      }
      if (dataset === "errors") {
        //https://sentry.io/api/0/organizations/sentry-mcp-evals/events/?dataset=errors&per_page=10&referrer=sentry-mcp&sort=-count&statsPeriod=1w&field=issue&field=title&field=project&field=last_seen%28%29&field=count%28%29&query=

        if (
          !fields.includes("issue") ||
          !fields.includes("title") ||
          !fields.includes("project") ||
          !fields.includes("last_seen()") ||
          !fields.includes("count()")
        ) {
          return HttpResponse.json("Invalid fields", { status: 400 });
        }

        if (
          !["-count", "-last_seen"].includes(
            url.searchParams.get("sort") as string,
          )
        ) {
          return HttpResponse.json("Invalid sort", { status: 400 });
        }

        // TODO: this is not correct, but itll fix test flakiness for now
        const sortedQuery = query ? query?.split(" ").sort().join(" ") : null;
        if (
          ![
            null,
            "",
            "error.handled:false",
            "error.unhandled:true",
            "error.handled:false is:unresolved",
            "error.unhandled:true is:unresolved",
            "is:unresolved project:cloudflare-mcp",
            "project:cloudflare-mcp",
            "user.email:david@sentry.io",
          ].includes(sortedQuery)
        ) {
          return HttpResponse.json(EmptyEventsErrorsPayload);
        }

        return HttpResponse.json(EventsErrorsPayload);
      }

      return HttpResponse.json("Invalid dataset", { status: 400 });
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/",
    ({ request }) => {
      const url = new URL(request.url);
      const sort = url.searchParams.get("sort");

      if (![null, "user", "freq", "date", "new", null].includes(sort)) {
        return HttpResponse.json(
          `Invalid sort: ${url.searchParams.get("sort")}`,
          {
            status: 400,
          },
        );
      }

      const collapse = url.searchParams.getAll("collapse");
      if (collapse.includes("stats")) {
        return HttpResponse.json(`Invalid collapse: ${collapse.join(",")}`, {
          status: 400,
        });
      }

      const query = url.searchParams.get("query");
      const sortedQuery = query ? query?.split(" ").sort().join(" ") : null;
      if (
        ![
          null,
          "",
          "is:unresolved",
          "error.handled:false is:unresolved",
          "error.unhandled:true is:unresolved",
          "project:cloudflare-mcp",
          "is:unresolved project:cloudflare-mcp",
          "user.email:david@sentry.io",
        ].includes(sortedQuery)
      ) {
        return HttpResponse.json([]);
      }

      if (sortedQuery === "user.email:david@sentry.io") {
        return HttpResponse.json([IssuePayload]);
      }

      if (sort === "date") {
        return HttpResponse.json([IssuePayload, IssuePayload2]);
      }
      return HttpResponse.json([IssuePayload2, IssuePayload]);
    },
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/",
    () => HttpResponse.json(IssuePayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376925/",
    () => HttpResponse.json(IssuePayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/",
    () => HttpResponse.json(IssuePayload2),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376926/",
    () => HttpResponse.json(IssuePayload2),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-41/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376925/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  // TODO: event payload should be tweaked to match issue
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/CLOUDFLARE-MCP-42/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  // TODO: event payload should be tweaked to match issue
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/6507376926/events/latest/",
    () => HttpResponse.json(EventPayload),
  ),
  http.get(
    "https://sentry.io/api/0/organizations/sentry-mcp-evals/releases/",
    () => HttpResponse.json([ReleasePayload]),
  ),
  http.get(
    "https://sentry.io/api/0/projects/sentry-mcp-evals/cloudflare-mcp/releases/",
    () => HttpResponse.json([ReleasePayload]),
  ),
  http.get("https://sentry.io/api/0/organizations/sentry-mcp-evals/tags/", () =>
    HttpResponse.json(TagsPayload),
  ),
];

export const mswServer = setupServer(...restHandlers);
