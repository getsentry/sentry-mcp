/**
 * Regression tests for the MCP path traversal class (VULN-2159, VULN-2174,
 * VULN-2450, VULN-2482).
 *
 * Unvalidated, unencoded Sentry resource IDs were interpolated into upstream REST
 * paths. Because `fetch` resolves `../` dot segments during URL parsing, an ID could
 * rewrite the path above the organization and project the server injects from the
 * session constraints, reaching other tenants with the granting user's credential.
 *
 * These tests drive tools through the same pipeline the server uses: the constrained
 * keys are stripped from the schema the client sees, the remaining params are parsed
 * with Zod, and the constraints are then injected server-side. Asserting on the
 * outbound request URL is what makes these meaningful, since the defect was only ever
 * observable in the path that actually left the process.
 */
import { mswServer } from "@sentry/mcp-server-mocks";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SentryApiService } from "../../api-client";
import { UserInputError } from "../../errors";
import {
  getFilteredInputSchema,
  injectConstraintParams,
} from "../catalog-runtime/availability";
import type { ToolConfig } from "../types";
import type { ServerContext } from "../../types";
import { getServerContext } from "../../test-setup.js";
import getEventAttachment from "./get-event-attachment";
import getIssueDetails from "./get-issue-details";
import getEventStacktrace from "./get-event-stacktrace";
import getProfileDetails from "./get-profile-details";
import getReplayDetails from "./get-replay-details";
import updateDsn from "./update-dsn";

const SCOPED_ORG = "sentry-mcp-evals";
const SCOPED_PROJECT = "cloudflare-mcp";
const VICTIM_ORG = "bbtest-victimorg";
const VICTIM_PROJECT = "victim-proj";

/**
 * Payloads that encoding renders inert, so the request is still issued but stays
 * within the constrained org and project.
 *
 * These are the exact shapes from the reports, plus the bypass variants VULN-2450
 * asked us to retest because encode-only fixes for this class have historically been
 * circumvented.
 */
const CONTAINED_PAYLOADS = [
  ["cross-project", `../../${VICTIM_PROJECT}/events/abc123`],
  ["cross-org", `../../../${VICTIM_ORG}/${VICTIM_PROJECT}/events/abc123`],
  [
    "deep cross-org",
    `../../../../../organizations/${VICTIM_ORG}/issues/130651143/events/latest`,
  ],
  ["escape api root", "../../../../../../../auth/config"],
  ["double encoded", `%252e%252e%252f%252e%252e%252f${VICTIM_ORG}`],
  ["single encoded", `%2e%2e%2f%2e%2e%2f${VICTIM_ORG}`],
  ["recursive", `....//....//${VICTIM_ORG}`],
  ["backslash", `..\\..\\${VICTIM_ORG}`],
  ["null byte", `abc\u0000/../${VICTIM_ORG}`],
  ["fragment truncation", "abc/#"],
  ["query injection", "abc/?download=1"],
  // Inert once encoded, because the `%` is itself encoded.
  ["bare encoded double dot", "%2e%2e"],
] as const;

/**
 * Payloads that are entirely a dot segment. These carry no separator, so encoding
 * leaves them intact and the URL parser still collapses them. They cannot name
 * another tenant, but they do consume a preceding segment and move the request to a
 * different endpoint, so `apiPath` rejects them outright and no request is issued.
 */
const REJECTED_PAYLOADS = [
  ["bare double dot", ".."],
  ["bare single dot", "."],
] as const;

const TRAVERSAL_PAYLOADS = [
  ...CONTAINED_PAYLOADS,
  ...REJECTED_PAYLOADS,
] as const;

let requestedUrls: string[] = [];

function recordRequest({ request }: { request: Request }) {
  requestedUrls.push(request.url);
}

beforeEach(() => {
  requestedUrls = [];
  mswServer.events.on("request:start", recordRequest);
});

afterEach(() => {
  mswServer.events.removeListener("request:start", recordRequest);
});

/**
 * Mirrors how the server handles a tool call: constrained keys are absent from the
 * schema exposed to the client, the rest is Zod-validated, then constraints are
 * injected. Returns the Zod error instead of throwing so callers can assert that
 * either validation rejected the input or the request stayed in scope.
 */
async function callToolAsClient(
  // Matches getFilteredInputSchema and injectConstraintParams, which take
  // ToolConfig<any> so they can accept tools with heterogeneous schemas.
  tool: ToolConfig<any>,
  clientParams: Record<string, unknown>,
  context: ServerContext,
): Promise<{ rejected: boolean }> {
  const schema = z.object(getFilteredInputSchema(tool, context));
  const parsed = schema.safeParse(clientParams);
  if (!parsed.success) {
    return { rejected: true };
  }

  try {
    await tool.handler(
      injectConstraintParams(parsed.data, tool, context),
      context,
    );
  } catch {
    // An upstream 404 or a formatting failure is irrelevant here. The assertion
    // that matters is which URL was requested, which is captured either way.
  }
  return { rejected: false };
}

/**
 * Every upstream request must stay within the constrained org and project.
 *
 * Asserts on decoded path *segments* rather than substrings: an encoded payload
 * legitimately still contains the victim slug as literal text, so a substring check
 * would flag a contained payload as an escape.
 */
function expectAllRequestsInScope() {
  for (const url of requestedUrls) {
    // Sentry API paths are /api/0/{projects|organizations}/{org}/...
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const anchor = segments.findIndex(
      (segment) => segment === "projects" || segment === "organizations",
    );

    expect(anchor).not.toBe(-1);
    expect(segments[anchor + 1]).toBe(SCOPED_ORG);
    expect(segments).not.toContain(VICTIM_ORG);
    expect(segments).not.toContain(VICTIM_PROJECT);
  }
}

describe("path traversal containment", () => {
  const scopedContext = () =>
    getServerContext({
      constraints: {
        organizationSlug: SCOPED_ORG,
        projectSlug: SCOPED_PROJECT,
      },
    });

  describe("a project-scoped session cannot escape its constraint", () => {
    it.each(TRAVERSAL_PAYLOADS)(
      "get_event_attachment eventId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          getEventAttachment,
          { eventId: payload },
          scopedContext(),
        );
        expectAllRequestsInScope();
      },
    );

    it.each(TRAVERSAL_PAYLOADS)(
      "get_event_attachment attachmentId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          getEventAttachment,
          {
            eventId: "99be789ee5555abf1ad81bd47c2c2e36",
            attachmentId: payload,
          },
          scopedContext(),
        );
        expectAllRequestsInScope();
      },
    );

    it.each(TRAVERSAL_PAYLOADS)(
      "get_issue_details eventId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          getIssueDetails,
          { issueId: "CLOUDFLARE-MCP-41", eventId: payload },
          scopedContext(),
        );
        expectAllRequestsInScope();
      },
    );

    it.each(TRAVERSAL_PAYLOADS)(
      "get_event_stacktrace eventId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          getEventStacktrace,
          { issueId: "CLOUDFLARE-MCP-41", eventId: payload },
          scopedContext(),
        );
        expectAllRequestsInScope();
      },
    );

    it.each(TRAVERSAL_PAYLOADS)(
      "get_replay_details replayId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          getReplayDetails,
          { replayId: payload },
          scopedContext(),
        );
        expectAllRequestsInScope();
      },
    );

    it.each(TRAVERSAL_PAYLOADS)(
      "get_profile_details profileId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          getProfileDetails,
          { profileId: payload },
          scopedContext(),
        );
        expectAllRequestsInScope();
      },
    );

    /**
     * The write half of VULN-2450: a confined token renamed and disabled DSNs in
     * another organization. This is the highest-impact sink in the class.
     */
    it.each(TRAVERSAL_PAYLOADS)(
      "update_dsn keyId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          updateDsn,
          { keyId: payload, name: "XORG-PWN", isActive: false },
          scopedContext(),
        );
        expectAllRequestsInScope();
      },
    );
  });

  describe("an org-only session cannot escape its organization", () => {
    const orgOnlyContext = () =>
      getServerContext({
        constraints: { organizationSlug: SCOPED_ORG, projectSlug: null },
      });

    it.each(TRAVERSAL_PAYLOADS)(
      "get_event_attachment eventId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          getEventAttachment,
          { projectSlug: SCOPED_PROJECT, eventId: payload },
          orgOnlyContext(),
        );
        expectAllRequestsInScope();
      },
    );

    it.each(TRAVERSAL_PAYLOADS)(
      "update_dsn keyId: %s",
      async (_label, payload) => {
        await callToolAsClient(
          updateDsn,
          {
            projectSlug: SCOPED_PROJECT,
            keyId: payload,
            name: "XORG-PWN",
            isActive: false,
          },
          orgOnlyContext(),
        );
        expectAllRequestsInScope();
      },
    );
  });

  /**
   * The schema refinements reject every payload above, so the tool-level tests never
   * reach the API client. That makes them a test of layer 2 only.
   *
   * This block drives the client directly with the same payloads, standing in for a
   * parameter that a future tool forgets to validate. It is the actual evidence that
   * the API client layer is load-bearing on its own, which is the reason this class of
   * bug should not recur the way it did after the slug-only fix in VULN-848.
   */
  describe("the API client contains traversal without any validation layer", () => {
    const apiService = () =>
      new SentryApiService({ accessToken: "access-token", host: "sentry.io" });

    const sinks = {
      listEventAttachments: (eventId: string) =>
        apiService().listEventAttachments({
          organizationSlug: SCOPED_ORG,
          projectSlug: SCOPED_PROJECT,
          eventId,
        }),
      getTransactionProfile: (profileId: string) =>
        apiService().getTransactionProfile({
          organizationSlug: SCOPED_ORG,
          projectSlugOrId: SCOPED_PROJECT,
          profileId,
        }),
      updateClientKey: (keyId: string) =>
        apiService().updateClientKey({
          organizationSlug: SCOPED_ORG,
          projectSlug: SCOPED_PROJECT,
          keyId,
          name: "XORG-PWN",
          isActive: false,
        }),
    };

    describe.each(Object.entries(sinks))("%s", (_name, call) => {
      it.each(CONTAINED_PAYLOADS)(
        "issues one in-scope request for %s",
        async (_label, payload) => {
          await call(payload).catch(() => {});

          expect(requestedUrls).toHaveLength(1);
          expectAllRequestsInScope();
        },
      );

      it.each(REJECTED_PAYLOADS)(
        "issues no request at all for %s",
        async (_label, payload) => {
          await expect(call(payload)).rejects.toThrow(UserInputError);

          expect(requestedUrls).toEqual([]);
        },
      );
    });
  });

  describe("constraint keys remain unreachable by the client", () => {
    it("strips organizationSlug and projectSlug from the exposed schema", () => {
      const schema = getFilteredInputSchema(
        getEventAttachment,
        scopedContext(),
      );

      expect(Object.keys(schema)).not.toContain("organizationSlug");
      expect(Object.keys(schema)).not.toContain("projectSlug");
      expect(Object.keys(schema)).toContain("eventId");
    });

    it("ignores a client attempt to override the injected constraints", () => {
      const injected = injectConstraintParams(
        { organizationSlug: VICTIM_ORG, projectSlug: VICTIM_PROJECT },
        getEventAttachment,
        scopedContext(),
      );

      expect(injected.organizationSlug).toBe(SCOPED_ORG);
      expect(injected.projectSlug).toBe(SCOPED_PROJECT);
    });
  });
});
