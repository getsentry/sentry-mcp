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
    model: process.env.FLUE_TRIAGE_MODEL || "openai/gpt-5",
  });
  const session = await agent.session();
  const commands = [gh, git, pnpm];

  const duplicateSearch = await session.skill("issue-triage", {
    args: { step: "search-duplicates", issueNumber, repository },
    commands: [gh],
    result: duplicateSearchSchema,
    timeout: 300_000,
  });

  if (duplicateSearch.status === "duplicate" && duplicateSearch.duplicate) {
    const closure = await session.skill("issue-triage", {
      args: {
        step: "close-duplicate",
        issueNumber,
        repository,
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

  const diagnosis = await session.skill("issue-triage", {
    args: {
      step: "diagnose-and-validate",
      issueNumber,
      repository,
      repositoryContext,
      duplicateSearch,
    },
    commands,
    result: diagnosisSchema,
    timeout: 900_000,
  });

  const update = await session.skill("issue-triage", {
    args: {
      step: "apply-triage-update",
      issueNumber,
      repository,
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
