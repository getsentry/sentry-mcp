import { createDefaultEvent, mswServer } from "@sentry/mcp-server-mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getServerContext } from "../../test-setup.js";
import getEventStacktrace from "./get-event-stacktrace.js";

const testIssue = {
  id: "6507376925",
  shortId: "THREADS-1",
  project: {
    id: "4509062593708032",
    slug: "cloudflare-mcp",
    name: "CLOUDFLARE-MCP",
  },
};

const eventWithThreads = createDefaultEvent({
  id: "event-with-threads",
  title: "Application crashed",
  message: "Application crashed",
  platform: "java",
  type: "error",
  entries: [
    {
      type: "message",
      data: {
        formatted: "Application crashed",
      },
    },
    {
      type: "threads",
      data: {
        values: [
          {
            id: 11,
            name: "worker",
            state: "WAITING",
            crashed: false,
            current: false,
            stacktrace: {
              frames: [
                {
                  filename: "Worker.java",
                  module: "com.example.Worker",
                  function: "waitForJob",
                  lineNo: 12,
                },
              ],
              hasSystemFrames: false,
            },
          },
          {
            id: 259,
            name: "main",
            state: "RUNNABLE",
            crashed: true,
            current: true,
            stacktrace: {
              frames: [
                {
                  filename: "Thread.java",
                  module: "java.lang.Thread",
                  function: "run",
                  lineNo: 833,
                  inApp: false,
                },
                {
                  filename: "CheckoutActivity.java",
                  module: "com.example.CheckoutActivity",
                  function: "submitOrder",
                  lineNo: 42,
                  inApp: true,
                  context: [
                    [40, "        Order order = buildOrder();"],
                    [41, "        if (order == null) {"],
                    [42, "            throw new IllegalStateException();"],
                    [43, "        }"],
                  ],
                },
              ],
              hasSystemFrames: true,
            },
          },
          {
            id: 300,
            name: "no-stack",
            state: "SLEEPING",
            crashed: false,
            current: false,
            stacktrace: null,
          },
        ],
      },
    },
  ],
});

function setupThreadMocks(event = eventWithThreads) {
  mswServer.use(
    http.get(
      "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/THREADS-1/",
      () => HttpResponse.json(testIssue),
    ),
    http.get(
      "https://sentry.io/api/0/organizations/sentry-mcp-evals/issues/THREADS-1/events/latest/",
      () => HttpResponse.json(event),
    ),
  );
}

function callHandler(
  overrides: Partial<Parameters<typeof getEventStacktrace.handler>[0]> = {},
) {
  return getEventStacktrace.handler(
    {
      organizationSlug: "sentry-mcp-evals",
      issueId: "THREADS-1",
      eventId: "latest",
      regionUrl: null,
      thread: undefined,
      ...overrides,
    },
    getServerContext(),
  );
}

describe("get_event_stacktrace", () => {
  it("returns Sentry's default selected thread stacktrace", async () => {
    setupThreadMocks();

    const result = await callHandler();

    expect(result).toMatchInlineSnapshot(`
      "# Event Stacktrace in **sentry-mcp-evals**

      **Issue ID**: THREADS-1
      **Event ID**: event-with-threads

      ## Selected Thread

      **Selection**: Sentry default selection: first crashed thread, then first thread with a stacktrace, then first thread.
      **Thread ID**: 259
      **Name**: main
      **State**: RUNNABLE
      **Crashed**: true
      **Current**: true

      ## Stacktrace

      **Most Relevant Frame:**
      ─────────────────────
      at com.example.CheckoutActivity.submitOrder(CheckoutActivity.java:42)

          40 │         Order order = buildOrder();
          41 │         if (order == null) {
        → 42 │             throw new IllegalStateException();
          43 │         }

      **Full Stacktrace:**
      ────────────────
      \`\`\`
      at java.lang.Thread.run(Thread.java:833)
      at com.example.CheckoutActivity.submitOrder(CheckoutActivity.java:42)
                  throw new IllegalStateException();
      \`\`\`
      "
    `);
  });

  it("selects a thread by numeric ID", async () => {
    setupThreadMocks();

    const result = await callHandler({ thread: 11 });

    expect(result).toContain("**Thread ID**: 11");
    expect(result).toContain(
      "at com.example.Worker.waitForJob(Worker.java:12)",
    );
  });

  it("selects a thread by exact name", async () => {
    setupThreadMocks();

    const result = await callHandler({ thread: "main" });

    expect(result).toContain("**Name**: main");
    expect(result).toContain("**Thread ID**: 259");
  });

  it("reports available threads when the selector does not match", async () => {
    setupThreadMocks();

    const result = await callHandler({ thread: "missing" });

    expect(result).toMatchInlineSnapshot(`
      "# Event Stacktrace in **sentry-mcp-evals**

      **Issue ID**: THREADS-1
      **Event ID**: event-with-threads

      No thread found with name "missing".

      ## Available Threads

      | Thread ID | Name | State | Flags | Frames |
      | --- | --- | --- | --- | ---: |
      | 11 | worker | WAITING | - | 1 |
      | 259 | main | RUNNABLE | crashed, current | 2 |
      | 300 | no-stack | SLEEPING | - | 0 |

      Pass \`thread\` as a numeric Thread ID or exact thread Name."
    `);
  });
});
