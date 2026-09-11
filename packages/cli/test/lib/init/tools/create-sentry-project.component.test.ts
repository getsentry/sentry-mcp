import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value) : value,
    ])
  );
});

vi.mock("../../../../src/lib/scope-recovery.js", () => ({
  captureOAuthScopeRecoveryGate: vi.fn(),
}));

// biome-ignore lint/performance/noNamespaceImport: assertions need module spies
import * as apiClient from "../../../../src/lib/api-client.js";
import { ApiError } from "../../../../src/lib/errors.js";
import { WizardCancelledError } from "../../../../src/lib/init/clack-utils.js";
import { createSentryProject } from "../../../../src/lib/init/tools/create-sentry-project.js";
import { executeTool } from "../../../../src/lib/init/tools/registry.js";
import type { CreateSentryProjectPayload } from "../../../../src/lib/init/types.js";
// biome-ignore lint/performance/noNamespaceImport: mocked recovery gate needs per-test behavior
import * as scopeRecovery from "../../../../src/lib/scope-recovery.js";

const payload: CreateSentryProjectPayload = {
  type: "tool",
  operation: "create-sentry-project",
  cwd: "/tmp/test",
  params: { name: "my-app", platform: "javascript-react" },
};

const context = {
  dryRun: false,
  org: "acme",
  team: undefined,
  project: undefined,
};

const shouldDelegateScopeRecovery = vi.fn();

describe("createSentryProject with the real team resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldDelegateScopeRecovery.mockResolvedValue(false);
    vi.mocked(scopeRecovery.captureOAuthScopeRecoveryGate).mockReturnValue({
      shouldDelegate: shouldDelegateScopeRecovery,
    });
    vi.mocked(apiClient.listTeams).mockResolvedValue([
      {
        id: "1",
        slug: "contributors",
        name: "Contributors",
        access: ["team:read"],
      },
    ]);
    vi.mocked(apiClient.getOrganization).mockResolvedValue({
      id: "1",
      slug: "acme",
      name: "Acme",
      access: ["project:admin", "team:admin"],
      allowMemberProjectCreation: false,
    });
    vi.mocked(apiClient.createTeam).mockResolvedValue({
      id: "2",
      slug: "my-app",
      name: "my-app",
    });
    vi.mocked(apiClient.createProjectWithDsn).mockResolvedValue({
      project: { id: "42", slug: "my-app" } as never,
      dsn: "https://key@o1.ingest.sentry.io/42",
      url: "https://sentry.io/settings/acme/projects/my-app/",
    });
  });

  test("creates a team and then its project in a restricted organization", async () => {
    const result = await createSentryProject(payload, context);

    expect(result.ok).toBe(true);
    expect(apiClient.createTeam).toHaveBeenCalledWith("acme", "my-app");
    expect(apiClient.createProjectWithDsn).toHaveBeenCalledWith(
      "acme",
      "my-app",
      { name: "my-app", platform: "javascript-react" }
    );
    expect(apiClient.createProjectWithAutoTeam).not.toHaveBeenCalled();
  });

  test("does not try an impossible org fallback if team creation loses permission", async () => {
    vi.mocked(apiClient.createTeam).mockRejectedValueOnce(
      new ApiError("Forbidden", 403, "Missing team permission")
    );
    shouldDelegateScopeRecovery.mockResolvedValueOnce(true);

    await expect(
      executeTool(payload, {
        directory: "/tmp/test",
        yes: true,
        ...context,
      })
    ).rejects.toMatchObject({
      status: 403,
      detail: expect.stringContaining("team:admin"),
    });
    expect(apiClient.createTeam).toHaveBeenCalledOnce();
    expect(apiClient.createProjectWithDsn).not.toHaveBeenCalled();
    expect(apiClient.createProjectWithAutoTeam).not.toHaveBeenCalled();
  });

  test("propagates cancellation from the interactive team chooser", async () => {
    vi.mocked(apiClient.listTeams).mockResolvedValueOnce([
      {
        id: "1",
        slug: "platform",
        name: "Platform",
        access: ["team:admin"],
      },
    ]);

    await expect(
      executeTool(
        payload,
        {
          directory: "/tmp/test",
          yes: false,
          ...context,
        },
        {
          chooseTeam: async () => {
            throw new WizardCancelledError();
          },
        }
      )
    ).rejects.toBeInstanceOf(WizardCancelledError);
    expect(apiClient.createProjectWithDsn).not.toHaveBeenCalled();
    expect(apiClient.createProjectWithAutoTeam).not.toHaveBeenCalled();
  });
});
