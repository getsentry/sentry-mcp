import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCommand } from "../../../../src/commands/alert/issues/create.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../../src/lib/api-client.js";
import { ValidationError } from "../../../../src/lib/errors.js";
import type { ResolvedTarget } from "../../../../src/lib/resolve-target.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-issues-create-", {
  isolateProjectRoot: true,
});

const sampleTarget: ResolvedTarget = {
  org: "test-org",
  project: "test-project",
  orgDisplay: "test-org",
  projectDisplay: "test-project",
};

type CreateFlags = {
  readonly name: string;
  readonly condition?: string[];
  readonly action?: string[];
  readonly "action-match"?: "all" | "any";
  readonly frequency: number;
  readonly environment?: string;
  readonly filter?: string[];
  readonly "filter-match"?: "all" | "any";
  readonly owner?: string;
  readonly "dry-run": boolean;
  readonly json: boolean;
};

function createContext() {
  const stdoutWrite = vi.fn(() => true);
  return {
    stdout: { write: stdoutWrite },
    stderr: { write: vi.fn(() => true) },
    cwd: getConfigDir(),
    stdoutWrite,
  };
}

describe("alert issues create", () => {
  let resolveSpy: ReturnType<typeof vi.spyOn>;
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveSpy = vi.spyOn(resolveTarget, "resolveTargetsFromParsedArg");
    createSpy = vi.spyOn(apiClient, "createIssueAlertRule");
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    createSpy.mockRestore();
  });

  test("requires --action-match", async () => {
    const context = createContext();
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await expect(
      func.call(
        context,
        {
          name: "Rule A",
          condition: ['{"id":"condition-a"}'],
          action: ['{"id":"action-a"}'],
          frequency: 30,
          "dry-run": true,
          json: true,
        },
        "test-org/test-project"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects blank rule name", async () => {
    const context = createContext();
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await expect(
      func.call(
        context,
        {
          name: "   ",
          condition: ['{"id":"condition-a"}'],
          action: ['{"id":"action-a"}'],
          "action-match": "any",
          frequency: 30,
          "dry-run": true,
          json: true,
        },
        "test-org/test-project"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects nonpositive frequency", async () => {
    const context = createContext();
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await expect(
      func.call(
        context,
        {
          name: "Rule A",
          condition: ['{"id":"condition-a"}'],
          action: ['{"id":"action-a"}'],
          "action-match": "any",
          frequency: 0,
          "dry-run": true,
          json: true,
        },
        "test-org/test-project"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("dry run does not call create API", async () => {
    const context = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Rule A",
        condition: ['{"id":"condition-a"}'],
        action: ['{"id":"action-a"}'],
        "action-match": "all",
        frequency: 30,
        "dry-run": true,
        json: true,
      },
      "test-org/test-project"
    );

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("dry run JSON includes optional fields and default filterMatch", async () => {
    const context = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Rule A",
        condition: ['{"id":"condition-a"}'],
        action: ['{"id":"action-a"}'],
        "action-match": "all",
        frequency: 30,
        environment: "prod",
        filter: ['{"id":"filter-a"}'],
        owner: "team:ops",
        "dry-run": true,
        json: true,
      },
      "test-org/test-project"
    );

    const parsed = JSON.parse(
      context.stdoutWrite.mock.calls.map((c) => c[0]).join("")
    );
    expect(parsed).toEqual({
      org: "test-org",
      project: "test-project",
      name: "Rule A",
      dryRun: true,
      body: {
        name: "Rule A",
        conditions: [{ id: "condition-a" }],
        actions: [{ id: "action-a" }],
        actionMatch: "all",
        frequency: 30,
        environment: "prod",
        filters: [{ id: "filter-a" }],
        filterMatch: "all",
        owner: "team:ops",
      },
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("rejects targets that resolve to multiple projects", async () => {
    const context = createContext();
    resolveSpy.mockResolvedValue({
      targets: [
        sampleTarget,
        {
          ...sampleTarget,
          project: "other-project",
          projectDisplay: "other-project",
        },
      ],
    });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await expect(
      func.call(
        context,
        {
          name: "Rule A",
          condition: ['{"id":"condition-a"}'],
          action: ['{"id":"action-a"}'],
          "action-match": "any",
          frequency: 30,
          "dry-run": true,
          json: true,
        },
        "test-org/"
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("calls create API with parsed body", async () => {
    const context = createContext();
    resolveSpy.mockResolvedValue({ targets: [sampleTarget] });
    createSpy.mockResolvedValue({
      id: "99",
      name: "Rule A",
      status: "active",
    });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Rule A",
        condition: ['{"id":"condition-a"}'],
        action: ['{"id":"action-a"}'],
        "action-match": "any",
        frequency: 15,
        "dry-run": false,
        json: true,
      },
      "test-org/test-project"
    );

    expect(createSpy).toHaveBeenCalledWith("test-org", "test-project", {
      name: "Rule A",
      conditions: [{ id: "condition-a" }],
      actions: [{ id: "action-a" }],
      actionMatch: "any",
      frequency: 15,
    });
  });
});
