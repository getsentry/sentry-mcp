/** Interactive team-choice adapter coverage for `sentry project create`. */

import { beforeEach, describe, expect, test, vi } from "vitest";

const { fakeLog, mockPrompt } = vi.hoisted(() => {
  const prompt = vi.fn<() => Promise<string | null>>();
  const noop = vi.fn();
  const log = {
    prompt,
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    success: noop,
    withTag: () => log,
  };
  return { fakeLog: log, mockPrompt: prompt };
});

vi.mock("../../../src/lib/logger.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/logger.js")>()),
  logger: fakeLog,
}));
vi.mock("../../../src/lib/api/projects.js");
vi.mock("../../../src/lib/api/teams.js");
vi.mock("../../../src/lib/api/organizations.js");
vi.mock("../../../src/lib/resolve-target.js");

import { createCommand } from "../../../src/commands/project/create.js";
import type { SentryContext } from "../../../src/context.js";
// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as projectsApi from "../../../src/lib/api/projects.js";
// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as teamsApi from "../../../src/lib/api/teams.js";
import { CliError } from "../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for vi.spyOn mocking
import * as resolveTarget from "../../../src/lib/resolve-target.js";

function createInteractiveContext(): SentryContext {
  return {
    process: { stdout: { isTTY: true } },
    env: {},
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    stdin: { isTTY: true },
    cwd: "/tmp",
    homeDir: "/tmp",
    configDir: "/tmp",
  } as unknown as SentryContext;
}

describe("project create interactive team choice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTarget.resolveOrg).mockResolvedValue({ org: "acme" });
    vi.mocked(teamsApi.listTeams).mockResolvedValue([
      {
        id: "1",
        slug: "platform",
        name: "Platform",
        access: ["team:admin"],
      },
      {
        id: "2",
        slug: "mobile",
        name: "Mobile",
        access: ["team:admin"],
      },
    ]);
    vi.mocked(projectsApi.createProjectWithDsn).mockResolvedValue({
      project: {
        id: "42",
        slug: "my-app",
        name: "my-app",
        platform: "node",
      },
      dsn: "https://key@example.com/42",
      url: "https://acme.sentry.io/projects/my-app/",
    });
    mockPrompt
      .mockResolvedValueOnce("existing")
      .mockResolvedValueOnce("mobile");
  });

  test("keeps create first, outside the team selector, and prompts once per batch", async () => {
    const context = createInteractiveContext();
    const func = await createCommand.loader();

    await func.call(context, { json: false }, "my-app:node", "worker:node");

    expect(mockPrompt).toHaveBeenCalledTimes(2);
    const firstOptions = mockPrompt.mock.calls[0]?.[1]?.options;
    expect(firstOptions).toEqual([
      {
        value: "create",
        label: "+ Create a new team",
      },
      { value: "existing", label: "Select an existing team" },
    ]);
    const secondOptions = mockPrompt.mock.calls[1]?.[1]?.options;
    expect(secondOptions).toEqual([
      expect.objectContaining({ value: "platform", label: "#platform" }),
      expect.objectContaining({ value: "mobile", label: "#mobile" }),
    ]);
    expect(
      secondOptions?.some(
        (option: { value: string }) => option.value === "create"
      )
    ).toBe(false);
    expect(projectsApi.createProjectWithDsn).toHaveBeenCalledWith(
      "acme",
      "mobile",
      { name: "my-app", platform: "node" }
    );
    expect(projectsApi.createProjectWithDsn).toHaveBeenCalledWith(
      "acme",
      "mobile",
      { name: "worker", platform: "node" }
    );
  });

  test("cancels cleanly before creating a project", async () => {
    mockPrompt.mockReset().mockResolvedValueOnce(null);
    const context = createInteractiveContext();
    const func = await createCommand.loader();

    await func.call(context, { json: false }, "my-app:node");

    expect(projectsApi.createProjectWithDsn).not.toHaveBeenCalled();
    expect(projectsApi.createProjectWithAutoTeam).not.toHaveBeenCalled();
    expect(fakeLog.info).toHaveBeenCalledWith("Cancelled.");
  });

  test("surfaces an invalid prompt result instead of treating it as cancellation", async () => {
    mockPrompt.mockReset().mockResolvedValueOnce("not-an-option");
    const context = createInteractiveContext();
    const func = await createCommand.loader();

    await expect(
      func.call(context, { json: false }, "my-app:node")
    ).rejects.toBeInstanceOf(CliError);

    expect(projectsApi.createProjectWithDsn).not.toHaveBeenCalled();
    expect(fakeLog.info).not.toHaveBeenCalledWith("Cancelled.");
  });
});
