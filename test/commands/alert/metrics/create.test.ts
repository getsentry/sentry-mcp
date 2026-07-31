import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCommand } from "../../../../src/commands/alert/metrics/create.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as apiClient from "../../../../src/lib/api-client.js";
import { ValidationError } from "../../../../src/lib/errors.js";
// biome-ignore lint/performance/noNamespaceImport: needed for spyOn mocking
import * as resolveTarget from "../../../../src/lib/resolve-target.js";
import { useTestConfigDir } from "../../../helpers.js";

const getConfigDir = useTestConfigDir("test-alert-metrics-create-", {
  isolateProjectRoot: true,
});

type CreateFlags = {
  readonly name: string;
  readonly query: string;
  readonly aggregate: string;
  readonly dataset: string;
  readonly "time-window": number;
  readonly trigger?: string[];
  readonly project?: string[];
  readonly environment?: string;
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

describe("alert metrics create", () => {
  let resolveOrgSpy: ReturnType<typeof vi.spyOn>;
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveOrgSpy = vi.spyOn(resolveTarget, "resolveOrg");
    createSpy = vi.spyOn(apiClient, "createMetricAlertRule");
  });

  afterEach(() => {
    resolveOrgSpy.mockRestore();
    createSpy.mockRestore();
  });

  test("rejects unsupported dataset", async () => {
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
          name: "Metric Rule",
          query: "event.type:error",
          aggregate: "count()",
          dataset: "unknown",
          "time-window": 5,
          trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
          "dry-run": true,
          json: true,
        },
        "test-org"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test.each([
    [
      "blank name",
      { name: "   ", query: "event.type:error", aggregate: "count()" },
    ],
    [
      "blank query",
      { name: "Metric Rule", query: "   ", aggregate: "count()" },
    ],
    [
      "blank aggregate",
      { name: "Metric Rule", query: "event.type:error", aggregate: "   " },
    ],
  ])("rejects %s", async (_, overrides) => {
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
          name: overrides.name,
          query: overrides.query,
          aggregate: overrides.aggregate,
          dataset: "errors",
          "time-window": 5,
          trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
          "dry-run": true,
          json: true,
        },
        "test-org"
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("dry run does not call create API", async () => {
    const context = createContext();
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        "time-window": 5,
        trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
        "dry-run": true,
        json: true,
      },
      "test-org"
    );

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("treats a bare metric create target as an organization slug", async () => {
    const context = createContext();
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        "time-window": 5,
        trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
        "dry-run": true,
        json: true,
      },
      "my-org"
    );

    expect(resolveOrgSpy).toHaveBeenCalledWith({
      org: "my-org",
      cwd: getConfigDir(),
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("ignores the project part for metric create org/project targets", async () => {
    const context = createContext();
    resolveOrgSpy.mockResolvedValue({ org: "my-org" });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        "time-window": 5,
        trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
        "dry-run": true,
        json: true,
      },
      "my-org/frontend"
    );

    expect(resolveOrgSpy).toHaveBeenCalledWith({
      org: "my-org",
      cwd: getConfigDir(),
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("dry run JSON includes normalized projects and optional fields", async () => {
    const context = createContext();
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        "time-window": 5,
        trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
        project: ["frontend, backend", "api"],
        environment: "prod",
        owner: "team:ops",
        "dry-run": true,
        json: true,
      },
      "test-org"
    );

    const parsed = JSON.parse(
      context.stdoutWrite.mock.calls.map((c) => c[0]).join("")
    );
    expect(parsed).toEqual({
      org: "test-org",
      name: "Metric Rule",
      dryRun: true,
      body: {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        timeWindow: 5,
        triggers: [{ alertThreshold: 100, actions: [{ id: "notify" }] }],
        projects: ["frontend", "backend", "api"],
        environment: "prod",
        owner: "team:ops",
      },
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("calls create API with parsed trigger payload", async () => {
    const context = createContext();
    resolveOrgSpy.mockResolvedValue({ org: "test-org" });
    createSpy.mockResolvedValue({
      id: "77",
      name: "Metric Rule",
      status: 0,
    });
    const func = (await createCommand.loader()) as unknown as (
      this: unknown,
      flags: CreateFlags,
      arg: string
    ) => Promise<void>;

    await func.call(
      context,
      {
        name: "Metric Rule",
        query: "event.type:error",
        aggregate: "count()",
        dataset: "errors",
        "time-window": 5,
        trigger: ['{"alertThreshold":100,"actions":[{"id":"notify"}]}'],
        "dry-run": false,
        json: true,
      },
      "test-org"
    );

    expect(createSpy).toHaveBeenCalledWith("test-org", {
      name: "Metric Rule",
      query: "event.type:error",
      aggregate: "count()",
      dataset: "errors",
      timeWindow: 5,
      triggers: [{ alertThreshold: 100, actions: [{ id: "notify" }] }],
    });
  });
});
