import type { FlueContext, FlueSession } from "@flue/sdk/client";
import { defineCommand } from "@flue/sdk/node";
import * as v from "valibot";

export const triggers = {};

const repositorySchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
);

const payloadSchema = v.object({
  issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
  repository: v.optional(repositorySchema),
});

const severitySchema = v.picklist(["low", "medium", "high", "critical"]);
const categorySchema = v.picklist([
  "bug",
  "documentation",
  "feature_request",
  "support",
  "security",
  "maintenance",
  "unknown",
]);

const duplicateCandidateSchema = v.object({
  number: v.number(),
  title: v.string(),
  url: v.string(),
  state: v.string(),
  confidence: v.picklist(["low", "medium", "high"]),
  reason: v.string(),
});

const duplicateSearchSchema = v.object({
  status: v.picklist(["duplicate", "unique", "uncertain"]),
  duplicate: v.optional(duplicateCandidateSchema),
  candidates: v.array(duplicateCandidateSchema),
  rationale: v.string(),
});

const duplicateClosureSchema = v.object({
  closed: v.boolean(),
  duplicate_issue: duplicateCandidateSchema,
  comment_posted: v.boolean(),
  labels_applied: v.array(v.string()),
  summary: v.string(),
});

const diagnosisSchema = v.object({
  severity: severitySchema,
  category: categorySchema,
  validity: v.picklist(["confirmed", "likely", "not_reproducible", "unclear"]),
  summary: v.string(),
  evidence: v.array(v.string()),
  labels_to_apply: v.array(v.string()),
  should_update_issue: v.boolean(),
  proposed_title: v.optional(v.string()),
  proposed_body: v.optional(v.string()),
  needs_human_review: v.boolean(),
});

const updateSchema = v.object({
  title_updated: v.boolean(),
  body_updated: v.boolean(),
  labels_applied: v.array(v.string()),
  comment_posted: v.boolean(),
  needs_human_review: v.boolean(),
  summary: v.string(),
});

const gh = defineCommand("gh", {
  env: {
    GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
  },
});
const git = defineCommand("git");
const pnpm = defineCommand("pnpm");

// Multi-turn calls against OpenAI reasoning models (gpt-5, gpt-5.5, o-series, ...) fail
// with `Items are not persisted when 'store' is set to false` because pi-ai —
// the LLM client Flue uses internally — hardcodes `store: false` on the
// OpenAI Responses API and replays `rs_*` reasoning IDs verbatim on the next
// turn. The supported escape hatch is to ask OpenAI to inline the encrypted
// reasoning blob (`include: ["reasoning.encrypted_content"]`); pi-ai's
// `convertResponsesMessages` then ships that blob back instead of trying to
// look the ID up server-side, so no `store=true` (and no provider-side
// retention) is required.
//
// Flue 0.3.11 doesn't expose a `reasoning`/`thinkingLevel` knob, so we reach
// into the Session's pi-agent-core harness and install an `onPayload` hook —
// pi-ai already invokes this hook to let callers mutate the final request
// payload right before it goes to the model. Drop this once @flue/sdk gates
// reasoning publicly (withastro/flue#69, merged but unreleased) or pi-ai
// stops hardcoding `store: false` (badlogic/pi-mono#3369).
type ResponsesPayload = {
  include?: string[];
  reasoning?: { effort?: string; summary?: string };
};
type ResponsesModel = { api?: string; reasoning?: boolean };
type Harness = {
  onPayload?: (
    params: ResponsesPayload,
    model: ResponsesModel,
  ) => ResponsesPayload | undefined;
};
type SessionWithHarness = FlueSession & { harness: Harness };

const REASONING_RESPONSES_APIS = new Set([
  "openai-responses",
  "azure-openai-responses",
]);

function enableEncryptedReasoning(session: FlueSession) {
  const harness = (session as SessionWithHarness).harness;
  if (!harness || typeof harness !== "object") {
    return;
  }
  harness.onPayload = (params, model) => {
    if (!model?.reasoning || !REASONING_RESPONSES_APIS.has(model.api ?? "")) {
      return params;
    }
    const include = new Set(
      Array.isArray(params.include) ? params.include : [],
    );
    include.add("reasoning.encrypted_content");
    params.include = Array.from(include);
    return params;
  };
}

type IssueContext = {
  issueNumber: number;
  repository?: string;
  issue: unknown;
  labels: unknown;
  fetchedAt: string;
};

function repoArg(repository?: string) {
  return repository ? ` --repo ${repository}` : "";
}

async function readJsonCommand(
  session: FlueSession,
  command: string,
  description: string,
) {
  const result = await session.shell(command, {
    commands: [gh],
    timeout: 60_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed: ${result.stderr || result.stdout}`.trim(),
    );
  }

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${description} returned invalid JSON: ${message}`);
  }
}

async function readIssueContext(
  session: FlueSession,
  issueNumber: number,
  repository?: string,
): Promise<IssueContext> {
  const repo = repoArg(repository);
  const issue = await readJsonCommand(
    session,
    `gh issue view ${issueNumber}${repo} --json title,body,author,labels,comments,url,state,createdAt,updatedAt`,
    "Fetching issue context",
  );
  const labels = await readJsonCommand(
    session,
    `gh label list${repo} --limit 200 --json name,description`,
    "Fetching repository labels",
  );
  const context: IssueContext = {
    issueNumber,
    issue,
    labels,
    fetchedAt: new Date().toISOString(),
  };

  if (repository) {
    context.repository = repository;
  }

  return context;
}

async function prepareRepository(
  session: FlueSession,
  issueNumber: number,
  repository?: string,
) {
  const root = await session.shell("git rev-parse --show-toplevel", {
    commands: [git],
    timeout: 30_000,
  });

  if (root.exitCode === 0) {
    const repoPath = root.stdout.trim();
    const remote = await session.shell("git remote get-url origin", {
      commands: [git],
      cwd: repoPath,
      timeout: 30_000,
    });
    const head = await session.shell("git rev-parse HEAD", {
      commands: [git],
      cwd: repoPath,
      timeout: 30_000,
    });

    return {
      checkoutAvailable: true,
      repoPath,
      remoteUrl: remote.exitCode === 0 ? remote.stdout.trim() : null,
      headSha: head.exitCode === 0 ? head.stdout.trim() : null,
      checkoutNote: "Using the repository checkout prepared by GitHub Actions.",
    };
  }

  if (!repository) {
    return {
      checkoutAvailable: false,
      repoPath: null,
      remoteUrl: null,
      headSha: null,
      checkoutNote:
        "No repository checkout was available and no repository was provided.",
    };
  }

  const clonePath = `.flue-issue-triage-${issueNumber}`;
  const clone = await session.shell(
    `gh repo clone ${repository} ${clonePath} -- --filter=blob:none`,
    {
      commands: [gh],
      timeout: 300_000,
    },
  );

  if (clone.exitCode !== 0) {
    return {
      checkoutAvailable: false,
      repoPath: null,
      remoteUrl: null,
      headSha: null,
      checkoutNote: `Repository clone failed: ${clone.stderr || clone.stdout}`,
    };
  }

  const head = await session.shell("git rev-parse HEAD", {
    commands: [git],
    cwd: clonePath,
    timeout: 30_000,
  });

  return {
    checkoutAvailable: true,
    repoPath: clonePath,
    remoteUrl: repository,
    headSha: head.exitCode === 0 ? head.stdout.trim() : null,
    checkoutNote:
      "Cloned the repository with gh repo clone using the GitHub token.",
  };
}

export default async function ({ init, payload }: FlueContext) {
  const { issueNumber, repository } = v.parse(payloadSchema, payload);
  const agent = await init({
    sandbox: "local",
    model: process.env.FLUE_TRIAGE_MODEL || "openai/gpt-5.5",
  });
  const session = await agent.session();
  enableEncryptedReasoning(session);
  const commands = [gh, git, pnpm];

  const initialContext = await readIssueContext(
    session,
    issueNumber,
    repository,
  );
  const duplicateSearch = await session.skill("issue-triage", {
    args: {
      stage: "search-duplicates",
      issueNumber,
      repository,
      context: initialContext,
    },
    commands: [gh],
    result: duplicateSearchSchema,
    timeout: 300_000,
  });

  if (duplicateSearch.status === "duplicate") {
    if (!duplicateSearch.duplicate) {
      throw new Error(
        `Duplicate search returned duplicate status without a canonical issue for #${issueNumber}.`,
      );
    }

    const closureContext = await readIssueContext(
      session,
      issueNumber,
      repository,
    );
    const closure = await session.skill("issue-triage", {
      args: {
        stage: "close-duplicate",
        issueNumber,
        repository,
        context: closureContext,
        duplicateSearch,
      },
      commands: [gh],
      result: duplicateClosureSchema,
      timeout: 300_000,
    });

    return {
      outcome: closure.closed ? "duplicate_closed" : "duplicate_closure_failed",
      steps: [
        { name: "search-duplicates", result: duplicateSearch.status },
        {
          name: "close-duplicate",
          result: closure.closed ? "closed" : "failed",
        },
      ],
      duplicate: closure.duplicate_issue,
      labels_applied: closure.labels_applied,
      comment_posted: closure.comment_posted,
      summary: closure.summary,
    };
  }

  const repositoryContext = await prepareRepository(
    session,
    issueNumber,
    repository,
  );

  const diagnosisContext = await readIssueContext(
    session,
    issueNumber,
    repository,
  );
  const diagnosis = await session.skill("issue-triage", {
    args: {
      stage: "diagnose-and-validate",
      issueNumber,
      repository,
      context: diagnosisContext,
      repositoryContext,
      duplicateSearch,
    },
    commands,
    result: diagnosisSchema,
    timeout: 900_000,
  });

  const updateContext = await readIssueContext(
    session,
    issueNumber,
    repository,
  );
  const update = await session.skill("issue-triage", {
    args: {
      stage: "apply-triage-update",
      issueNumber,
      repository,
      context: updateContext,
      repositoryContext,
      duplicateSearch,
      diagnosis,
    },
    commands: [gh],
    result: updateSchema,
    timeout: 300_000,
  });

  return {
    outcome: update.needs_human_review ? "needs_human_review" : "triaged",
    steps: [
      { name: "search-duplicates", result: duplicateSearch.status },
      {
        name: "prepare-repository",
        result: repositoryContext.checkoutAvailable ? "ready" : "unavailable",
      },
      { name: "diagnose-and-validate", result: diagnosis.validity },
      { name: "apply-triage-update", result: update.summary },
    ],
    severity: diagnosis.severity,
    category: diagnosis.category,
    validity: diagnosis.validity,
    labels_applied: update.labels_applied,
    comment_posted: update.comment_posted,
    title_updated: update.title_updated,
    body_updated: update.body_updated,
    needs_human_review: update.needs_human_review,
    summary: update.summary,
  };
}
