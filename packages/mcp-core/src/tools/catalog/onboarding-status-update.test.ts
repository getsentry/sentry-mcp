import { mswServer } from "@sentry/mcp-server-mocks";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import onboardingStatusUpdate from "./onboarding-status-update.js";

const context = {
  constraints: {
    organizationSlug: null,
    projectSlug: null,
    regionUrl: null,
  },
  accessToken: "access-token",
  userId: "1",
};

describe("onboarding_status_update", () => {
  afterEach(() => {
    mswServer.resetHandlers();
  });

  it("updates onboarding progress without echoing its inputs", async () => {
    let requestBody: unknown;
    mswServer.use(
      http.post(
        "https://us.sentry.io/api/0/organizations/sentry-mcp-evals/onboarding/agent/status/",
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            schemaVersion: 1,
            runId: "2d27f6654b754dcaa2d26af18274d142",
            channelId: "6835652362204cb1b10719783c26983a",
            clientRunId: "e806c6f4-fef8-47b4-a720-5ab582b2fcf0",
            createdAt: "2026-08-12T12:00:00Z",
            updatedAt: "2026-08-12T12:01:00Z",
            sequence: 3,
            expiresAt: "2026-08-13T12:00:00Z",
            continueUpdates: true,
            runStatus: "active",
            projectSlugs: ["private-project", "worker-project"],
            issueIds: [],
            stages: [
              {
                stage: "analyze_project",
                status: "bypassed",
                eventNote: null,
              },
            ],
          });
        },
      ),
    );

    const result = await onboardingStatusUpdate.handler(
      {
        organizationSlug: "sentry-mcp-evals",
        regionUrl: "https://us.sentry.io",
        runToken: "a1B2c3D4e5",
        stage: "create_project",
        status: "completed",
        eventNote: "Project already existed.",
        projectSlugs: ["private-project", "worker-project"],
      },
      context,
    );

    expect(requestBody).toEqual({
      schemaVersion: 1,
      runToken: "a1B2c3D4e5",
      stage: "create_project",
      status: "completed",
      eventNote: "Project already existed.",
      projectSlugs: ["private-project", "worker-project"],
    });
    expect(result).toMatchInlineSnapshot(
      `"Onboarding status updated. Continue updates: yes."`,
    );
    expect(result).not.toContain("a1B2c3D4e5");
    expect(result).not.toContain("private-project");
  });

  it("does not accept the backend-derived bypassed status as input", () => {
    expect(
      onboardingStatusUpdate.inputSchema.status.safeParse("bypassed").success,
    ).toBe(false);
    expect(onboardingStatusUpdate.inputSchema).not.toHaveProperty(
      "failureReason",
    );
    expect(
      onboardingStatusUpdate.inputSchema.projectSlugs.safeParse([]).success,
    ).toBe(false);
    expect(
      onboardingStatusUpdate.inputSchema.issueIds.safeParse([]).success,
    ).toBe(false);
  });

  it("uses the default mock endpoint", async () => {
    await expect(
      onboardingStatusUpdate.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: null,
          runToken: "a1B2c3D4e5",
          stage: "connect_mcp",
          status: "completed",
        },
        context,
      ),
    ).resolves.toBe("Onboarding status updated. Continue updates: yes.");
  });

  it("accepts nullable reference lists from the backend", async () => {
    mswServer.use(
      http.post(
        "https://us.sentry.io/api/0/organizations/sentry-mcp-evals/onboarding/agent/status/",
        () =>
          HttpResponse.json({
            schemaVersion: 1,
            runId: "2d27f6654b754dcaa2d26af18274d142",
            channelId: "6835652362204cb1b10719783c26983a",
            clientRunId: "e806c6f4-fef8-47b4-a720-5ab582b2fcf0",
            createdAt: "2026-08-12T12:00:00Z",
            updatedAt: "2026-08-12T12:01:00Z",
            sequence: 1,
            expiresAt: "2026-08-13T12:00:00Z",
            continueUpdates: true,
            runStatus: "active",
            projectSlugs: null,
            issueIds: null,
            stages: [],
          }),
      ),
    );

    await expect(
      onboardingStatusUpdate.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: "https://us.sentry.io",
          runToken: "a1B2c3D4e5",
          stage: "connect_mcp",
          status: "completed",
        },
        context,
      ),
    ).resolves.toBe("Onboarding status updated. Continue updates: yes.");
  });

  it("reports when the run no longer accepts updates", async () => {
    mswServer.use(
      http.post(
        "https://us.sentry.io/api/0/organizations/sentry-mcp-evals/onboarding/agent/status/",
        () =>
          HttpResponse.json({
            schemaVersion: 1,
            runId: "2d27f6654b754dcaa2d26af18274d142",
            channelId: "6835652362204cb1b10719783c26983a",
            clientRunId: "e806c6f4-fef8-47b4-a720-5ab582b2fcf0",
            createdAt: "2026-08-12T12:00:00Z",
            updatedAt: "2026-08-12T12:01:00Z",
            sequence: 9,
            expiresAt: "2026-08-13T12:00:00Z",
            continueUpdates: false,
            runStatus: "completed",
            projectSlugs: [],
            issueIds: [],
            stages: [],
          }),
      ),
    );

    await expect(
      onboardingStatusUpdate.handler(
        {
          organizationSlug: "sentry-mcp-evals",
          regionUrl: "https://us.sentry.io",
          runToken: "a1B2c3D4e5",
          stage: "check_stack_trace_quality",
          status: "completed",
          runStatus: "completed",
        },
        context,
      ),
    ).resolves.toBe("Onboarding status updated. Continue updates: no.");
  });
});
