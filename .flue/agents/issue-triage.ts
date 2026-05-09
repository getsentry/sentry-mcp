import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const dispositionSchema = v.picklist([
  "actionable",
  "needs_more_info",
  "low_actionability",
  "impractical_scope",
  "unclear",
]);
const rewriteModeSchema = v.picklist([
  "none",
  "light_cleanup",
  "technical_diagnosis",
  "scope_clarification",
]);

const duplicateCandidateSchema = v.object({
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
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
type DuplicateSearch = v.InferOutput<typeof duplicateSearchSchema>;
type DuplicateCandidate = v.InferOutput<typeof duplicateCandidateSchema>;

const diagnosisSchema = v.object({
  severity: severitySchema,
  category: categorySchema,
  disposition: dispositionSchema,
  rewrite_mode: rewriteModeSchema,
  validity: v.picklist(["confirmed", "likely", "not_reproducible", "unclear"]),
  summary: v.string(),
  evidence: v.array(v.string()),
  labels_to_apply: v.array(v.string()),
  should_comment: v.boolean(),
  should_update_issue: v.boolean(),
  proposed_title: v.optional(v.string()),
  proposed_body: v.optional(v.string()),
  triage_comment: v.optional(v.string()),
  update_comment: v.optional(v.string()),
  needs_human_review: v.boolean(),
});
type Diagnosis = v.InferOutput<typeof diagnosisSchema>;

const updateSchema = v.object({
  title_updated: v.boolean(),
  body_updated: v.boolean(),
  labels_applied: v.array(v.string()),
  comment_posted: v.boolean(),
  needs_human_review: v.boolean(),
  summary: v.string(),
});

function summarizeAgentFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("404 status code")) {
    return "The triage model returned a provider error before producing structured output.";
  }

  if (message.includes("Gateway Timeout")) {
    return "The triage model timed out before producing structured output.";
  }

  return "The triage agent failed before producing structured output.";
}

function buildDuplicateSearchFailure(error: unknown): DuplicateSearch {
  return {
    status: "uncertain",
    candidates: [],
    rationale: summarizeAgentFailure(error),
  };
}

function buildDiagnosisFailure(error: unknown): Diagnosis {
  return {
    severity: "low",
    category: "unknown",
    disposition: "unclear",
    rewrite_mode: "none",
    validity: "unclear",
    summary:
      "Automated triage could not complete, so the issue is left unchanged for maintainer review.",
    evidence: [summarizeAgentFailure(error)],
    labels_to_apply: [],
    should_comment: false,
    should_update_issue: false,
    needs_human_review: true,
  };
}

const gh = defineCommand("gh", {
  env: {
    GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
  },
});
const git = defineCommand("git");
const pnpm = defineCommand("pnpm");

// pi-ai currently replays OpenAI Responses reasoning IDs with store=false.
// Inline encrypted reasoning until Flue/pi-ai expose this cleanly.
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

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function repoArg(repository?: string) {
  return repository ? ` --repo ${shellQuote(repository)}` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getIssueState(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.state !== "string") {
    return null;
  }
  return context.issue.state.toLowerCase();
}

function getIssueTitle(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.title !== "string") {
    return "";
  }
  return context.issue.title;
}

function getIssueBody(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.body !== "string") {
    return "";
  }
  return context.issue.body;
}

function existingLabels(context: IssueContext) {
  if (!Array.isArray(context.labels)) {
    return new Map<string, string>();
  }

  const labels = new Map<string, string>();
  for (const label of context.labels) {
    if (isRecord(label) && typeof label.name === "string") {
      labels.set(label.name.toLowerCase(), label.name);
    }
  }
  return labels;
}

function filterExistingLabels(context: IssueContext, labels: string[]) {
  const available = existingLabels(context);
  const result = new Map<string, string>();

  for (const label of labels) {
    const existing = available.get(label.toLowerCase());
    if (existing) {
      result.set(existing.toLowerCase(), existing);
    }
  }

  return Array.from(result.values());
}

function findDuplicateLabel(context: IssueContext) {
  return existingLabels(context).get("duplicate") ?? null;
}

export const TRIAGE_BOT_INTRO = ":wave: I'm the issue triage bot.";

function getFirstParagraph(value: string) {
  return value.trim().split(/\n\s*\n/, 1)[0] ?? "";
}

function getFirstSentence(value: string) {
  const firstParagraph = getFirstParagraph(value);
  const sentenceEnd = firstParagraph.search(/[.!?](?:\s|$)/);

  if (sentenceEnd === -1) {
    return firstParagraph;
  }

  return firstParagraph.slice(0, sentenceEnd + 1);
}

export function hasIssueTriageBotIntro(body: string) {
  return /\bissue triage bot\b/i.test(getFirstSentence(body));
}

export function withIssueTriageBotIntro(body?: string) {
  const trimmed = body?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (hasIssueTriageBotIntro(trimmed)) {
    return trimmed;
  }

  return `${TRIAGE_BOT_INTRO}\n\n${trimmed}`;
}

function normalizeStateReason(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.toLowerCase().replace(/[\s-]+/g, "_");
}

export function wasClosedAsNotPlanned(issue: unknown) {
  if (!isRecord(issue)) {
    return false;
  }

  const state =
    typeof issue.state === "string" ? issue.state.toLowerCase() : "";
  return (
    state === "closed" &&
    ["not_planned", "wontfix", "wont_fix"].includes(
      normalizeStateReason(issue.stateReason),
    )
  );
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

async function runGhCommand(
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
}

async function withGhBodyFile<T>(
  prefix: string,
  body: string,
  callback: (path: string) => Promise<T>,
) {
  const dir = await mkdtemp(join(tmpdir(), "issue-triage-"));
  const path = join(dir, `${prefix}.md`);

  await writeFile(path, body, "utf8");

  try {
    return await callback(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function applyLabels(
  session: FlueSession,
  context: IssueContext,
  labels: string[],
) {
  const repo = repoArg(context.repository);
  const applied: string[] = [];

  for (const label of filterExistingLabels(context, labels)) {
    await runGhCommand(
      session,
      `gh issue edit ${context.issueNumber}${repo} --add-label ${shellQuote(label)}`,
      `Applying label ${label}`,
    );
    applied.push(label);
  }

  return applied;
}

async function editIssueTitle(
  session: FlueSession,
  context: IssueContext,
  title?: string,
) {
  const nextTitle = title?.trim();
  if (!nextTitle || nextTitle === getIssueTitle(context).trim()) {
    return false;
  }

  await runGhCommand(
    session,
    `gh issue edit ${context.issueNumber}${repoArg(context.repository)} --title ${shellQuote(nextTitle)}`,
    "Updating issue title",
  );
  return true;
}

async function editIssueBody(
  session: FlueSession,
  context: IssueContext,
  body?: string,
) {
  const nextBody = body?.trim();
  if (!nextBody || nextBody === getIssueBody(context).trim()) {
    return false;
  }

  await withGhBodyFile(`issue-${context.issueNumber}-body`, nextBody, (path) =>
    runGhCommand(
      session,
      `gh issue edit ${context.issueNumber}${repoArg(context.repository)} --body-file ${shellQuote(path)}`,
      "Updating issue body",
    ),
  );
  return true;
}

async function postComment(
  session: FlueSession,
  context: IssueContext,
  body?: string,
) {
  const comment = withIssueTriageBotIntro(body);
  if (!comment) {
    return false;
  }

  await withGhBodyFile(
    `issue-${context.issueNumber}-comment`,
    comment,
    (path) =>
      runGhCommand(
        session,
        `gh issue comment ${context.issueNumber}${repoArg(context.repository)} --body-file ${shellQuote(path)}`,
        "Posting issue comment",
      ),
  );
  return true;
}

async function readIssueClosureContext(
  session: FlueSession,
  issueNumber: number,
  repository?: string,
) {
  return readJsonCommand(
    session,
    `gh issue view ${issueNumber}${repoArg(repository)} --json number,title,state,stateReason,url`,
    `Fetching canonical duplicate #${issueNumber}`,
  );
}

export function buildDuplicateClosureComment(
  duplicate: DuplicateCandidate,
  closeAsNotPlanned: boolean,
) {
  if (closeAsNotPlanned) {
    return [
      `Quick triage read: this matches #${duplicate.number}, which was already closed as not planned.`,
      "",
      "I'm closing this with the same resolution so we do not keep two copies of the same ask open.",
    ].join("\n");
  }

  return [
    `Quick triage read: this looks like the same request as #${duplicate.number}.`,
    "",
    `I'm keeping the thread tidy by closing this one so updates stay on #${duplicate.number}.`,
  ].join("\n");
}

async function closeDuplicate(
  session: FlueSession,
  context: IssueContext,
  duplicate: DuplicateCandidate,
  canonicalIssue?: unknown,
) {
  const duplicateLabel = findDuplicateLabel(context);
  const labelsApplied = duplicateLabel
    ? await applyLabels(session, context, [duplicateLabel])
    : [];
  const closeAsNotPlanned = wasClosedAsNotPlanned(canonicalIssue);
  const comment = buildDuplicateClosureComment(duplicate, closeAsNotPlanned);

  await postComment(session, context, comment);
  if (closeAsNotPlanned) {
    await runGhCommand(
      session,
      `gh issue close ${context.issueNumber}${repoArg(context.repository)} --reason ${shellQuote("not planned")}`,
      "Closing issue as not planned",
    );
  } else {
    await runGhCommand(
      session,
      `gh issue close ${context.issueNumber}${repoArg(context.repository)} --reason duplicate --duplicate-of ${duplicate.number}`,
      "Closing duplicate issue",
    );
  }

  return labelsApplied;
}

function buildIssueUpdateComment(
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
) {
  const evidence = diagnosis.evidence
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  const lines = [TRIAGE_BOT_INTRO, ""];

  switch (diagnosis.rewrite_mode) {
    case "light_cleanup":
      lines.push(
        "I gave the report a quick cleanup so the concrete ask is easier to scan without changing it.",
      );
      break;
    case "scope_clarification":
      lines.push(
        "I trimmed this to the actual ask and what maintainers still need.",
      );
      break;
    case "technical_diagnosis":
      lines.push("I added the repo context that looks relevant for this one.");
      break;
    case "none":
      lines.push("I added a quick triage note for maintainer review.");
      break;
  }

  if (diagnosis.summary.trim()) {
    lines.push("", `Quick triage read: ${diagnosis.summary.trim()}`);
  }

  if (diagnosis.rewrite_mode === "technical_diagnosis" && evidence.length > 0) {
    lines.push("", "What I checked:");
    for (const item of evidence) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", "A maintainer will take it from here.");

  return lines.join("\n");
}

function selectTriageComment(
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
  bodyUpdated: boolean,
) {
  if (bodyUpdated) {
    return (
      diagnosis.update_comment?.trim() ||
      diagnosis.triage_comment?.trim() ||
      buildIssueUpdateComment(diagnosis)
    );
  }

  if (!diagnosis.should_comment) {
    return undefined;
  }

  return diagnosis.triage_comment?.trim();
}

async function applyTriageUpdate(
  session: FlueSession,
  context: IssueContext,
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
): Promise<v.InferOutput<typeof updateSchema>> {
  if (getIssueState(context) === "closed") {
    return {
      title_updated: false,
      body_updated: false,
      labels_applied: [],
      comment_posted: false,
      needs_human_review: true,
      summary: "Skipped triage update because the issue is already closed.",
    };
  }

  const labelsApplied = await applyLabels(
    session,
    context,
    diagnosis.labels_to_apply,
  );
  let titleUpdated = false;
  let bodyUpdated = false;
  let commentPosted = false;

  if (diagnosis.should_update_issue) {
    titleUpdated = await editIssueTitle(
      session,
      context,
      diagnosis.proposed_title,
    );
    bodyUpdated = await editIssueBody(
      session,
      context,
      diagnosis.proposed_body,
    );

    const comment = selectTriageComment(diagnosis, bodyUpdated);
    if (comment) {
      commentPosted = await postComment(session, context, comment);
    }
  } else {
    const comment = selectTriageComment(diagnosis, false);
    if (comment) {
      commentPosted = await postComment(session, context, comment);
    }
  }

  const changed = [
    titleUpdated ? "title" : null,
    bodyUpdated ? "body" : null,
    labelsApplied.length > 0 ? "labels" : null,
    commentPosted ? "comment" : null,
  ].filter(Boolean);

  return {
    title_updated: titleUpdated,
    body_updated: bodyUpdated,
    labels_applied: labelsApplied,
    comment_posted: commentPosted,
    needs_human_review: diagnosis.needs_human_review,
    summary:
      changed.length > 0
        ? `Updated issue ${changed.join(", ")}.`
        : "No issue update was needed.",
  };
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
    `gh repo clone ${shellQuote(repository)} ${shellQuote(clonePath)} -- --filter=blob:none`,
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
  if (!process.env.OPENAI_API_KEY && process.env.FLUE_OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.FLUE_OPENAI_API_KEY;
  }

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
  let duplicateSearch: DuplicateSearch;
  try {
    duplicateSearch = await session.skill("issue-triage", {
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
  } catch (error) {
    console.warn(
      `[issue-triage] Duplicate search failed: ${summarizeAgentFailure(error)}`,
    );
    duplicateSearch = buildDuplicateSearchFailure(error);
  }

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
    let canonicalIssue: unknown;
    try {
      canonicalIssue = await readIssueClosureContext(
        session,
        duplicateSearch.duplicate.number,
        repository,
      );
    } catch (error) {
      console.warn(
        `[issue-triage] Canonical duplicate lookup failed: ${summarizeAgentFailure(error)}`,
      );
    }
    const labelsApplied = await closeDuplicate(
      session,
      closureContext,
      duplicateSearch.duplicate,
      canonicalIssue,
    );
    const closedAsNotPlanned = wasClosedAsNotPlanned(canonicalIssue);

    return {
      outcome: closedAsNotPlanned
        ? "duplicate_closed_as_not_planned"
        : "duplicate_closed",
      steps: [
        { name: "search-duplicates", result: duplicateSearch.status },
        {
          name: "close-duplicate",
          result: closedAsNotPlanned ? "closed_as_not_planned" : "closed",
        },
      ],
      duplicate: duplicateSearch.duplicate,
      labels_applied: labelsApplied,
      comment_posted: true,
      summary: closedAsNotPlanned
        ? `Closed as not planned because #${duplicateSearch.duplicate.number} was already closed as not planned.`
        : `Closed as a duplicate of #${duplicateSearch.duplicate.number}.`,
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
  let diagnosis: Diagnosis;
  try {
    diagnosis = await session.skill("issue-triage", {
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
  } catch (error) {
    console.warn(
      `[issue-triage] Diagnosis failed: ${summarizeAgentFailure(error)}`,
    );
    diagnosis = buildDiagnosisFailure(error);
  }

  const updateContext = await readIssueContext(
    session,
    issueNumber,
    repository,
  );
  const update = await applyTriageUpdate(session, updateContext, diagnosis);

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
    disposition: diagnosis.disposition,
    rewrite_mode: diagnosis.rewrite_mode,
    validity: diagnosis.validity,
    labels_applied: update.labels_applied,
    comment_posted: update.comment_posted,
    title_updated: update.title_updated,
    body_updated: update.body_updated,
    needs_human_review: update.needs_human_review,
    summary: update.summary,
  };
}
