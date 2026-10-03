import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createCloudflareJournalStore,
  runCli,
} from "./cloudflare-journal-store.mjs";

const API_ORIGIN = "https://api.github.com";
const REPOSITORY = "acme/widgets";
const TOKEN = "github_pat_test-token";
const BRANCH_REF = "refs/heads/cloudflare-deployment-journal";
const TRUSTED_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXTERNAL_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WORKER_TAG = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PREVIOUS_VERSION = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_VERSION = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_DEPLOYMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAIMANT_HEAD = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DEFAULT_BRANCH = "main";
const DEPLOY_WORKFLOW_ID = 700;
const DEPLOY_JOB_ID = 800;
const JOURNAL_APP_ID = 900;
const HMAC_KEY = "12".repeat(32);
const STATUS_MAC_DOMAIN = "sentry/cloudflare-journal-anchor/v1\0";
const STATUS_CONTEXT_PREFIX = "cloudflare-deployment-journal/v1";
const STATUS_DESCRIPTION_PREFIX = "hmac-sha256:v1:";
const STATUS_TARGET_FRAGMENT = "cloudflare-journal-anchor-v1=";

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function makeAuthenticatedStatus(id, record, overrides = {}) {
  const payload = Buffer.from(canonicalJson(record), "utf8").toString(
    "base64url",
  );
  const mac = createHmac("sha256", Buffer.from(HMAC_KEY, "hex"))
    .update(STATUS_MAC_DOMAIN)
    .update(canonicalJson(record))
    .digest("hex");
  return {
    id,
    sha: TRUSTED_SHA,
    state: record.phase === "prepared" ? "pending" : "success",
    target_url: `https://github.com/${REPOSITORY}/commit/${record.nextHeadSha}#${STATUS_TARGET_FRAGMENT}${payload}`,
    description: `${STATUS_DESCRIPTION_PREFIX}${mac}`,
    context: `${STATUS_CONTEXT_PREFIX}/${record.sequence}/${record.phase}`,
    ...overrides,
  };
}

function readStatusRecord(status) {
  const encoded = new URL(status.target_url).hash.slice(
    `#${STATUS_TARGET_FRAGMENT}`.length,
  );
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function addAuthenticatedAnchor(
  api,
  {
    previousHeadSha,
    nextHeadSha,
    transition,
    recordPath,
    recordBlobSha,
    committed = true,
    sequence: suppliedSequence,
  },
) {
  const sequences = api.statuses
    .map(({ context }) =>
      /^cloudflare-deployment-journal\/v1\/([1-9][0-9]*)\/(?:prepared|committed)$/.exec(
        context,
      ),
    )
    .filter((match) => match !== null)
    .map((match) => Number(match[1]));
  const sequence =
    suppliedSequence ??
    (sequences.length === 0 ? 0 : Math.max(...sequences)) + 1;
  for (const phase of committed ? ["prepared", "committed"] : ["prepared"]) {
    const record = {
      schemaVersion: 1,
      repository: REPOSITORY,
      writerAppId: JOURNAL_APP_ID,
      trustedSha: TRUSTED_SHA,
      sequence,
      phase,
      transition,
      previousHeadSha,
      nextHeadSha,
      recordPath,
      recordBlobSha,
    };
    api.statuses.push(makeAuthenticatedStatus(api.nextStatusId, record));
    api.nextStatusId += 1;
  }
}

function addMalformedTransitionAnchor(api, transition, overrides = {}) {
  addAuthenticatedAnchor(api, {
    ...transition,
    transition: "append",
    recordPath: ".github/cloudflare-deployment-journals/999999-1.json",
    recordBlobSha: api.blobs.keys().next().value,
    ...overrides,
  });
}

function makeRulesets(appId = JOURNAL_APP_ID) {
  const makeConditions = () => ({
    ref_name: { include: [BRANCH_REF], exclude: [] },
  });
  return [
    {
      id: 1,
      name: "Cloudflare deployment journal writer",
      target: "branch",
      source_type: "Repository",
      source: REPOSITORY,
      enforcement: "active",
      bypass_actors: [
        {
          actor_id: appId,
          actor_type: "Integration",
          bypass_mode: "always",
        },
      ],
      conditions: makeConditions(),
      rules: [
        { type: "creation" },
        {
          type: "update",
          parameters: { update_allows_fetch_and_merge: false },
        },
      ],
    },
    {
      id: 2,
      name: "Cloudflare deployment journal immutable history",
      target: "branch",
      source_type: "Repository",
      source: REPOSITORY,
      enforcement: "active",
      bypass_actors: [],
      conditions: makeConditions(),
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        { type: "required_linear_history" },
      ],
    },
  ];
}

function makeRulesetSummaries(rulesets) {
  return rulesets.map(
    ({ enforcement, id, name, source, source_type, target }) => ({
      id,
      name,
      target,
      source_type,
      source,
      enforcement,
    }),
  );
}

function makeBootstrapSteps(conclusionOverrides = {}) {
  return [
    ["Set up job", "success"],
    ["Validate trusted Test revision", "success"],
    ["Check out tested revision", "success"],
    ["Setup Node.js", "success"],
    ["Install dependencies", "success"],
    ["Discover deployment projects", "success"],
    ["Reconcile the newest durable deployment journal", "failure"],
    ["Build production artifact once", "skipped"],
    ["Reconcile Cloudflare state", "skipped"],
    ["Post Setup Node.js", "success"],
    ["Complete job", "success"],
  ].map(([name, defaultConclusion], index) => ({
    name,
    number: index + 1,
    status: "completed",
    conclusion: conclusionOverrides[name] ?? defaultConclusion,
  }));
}

function makeClaim(journal, overrides = {}) {
  return {
    schemaVersion: 1,
    targetRunId: journal.runId,
    targetRunAttempt: journal.runAttempt,
    claimantRunId: 200,
    claimantRunAttempt: 1,
    claimantWorkflowId: 300,
    claimantHeadSha: CLAIMANT_HEAD,
    action: "restore",
    takeover: null,
    ...overrides,
  };
}

function setWorkflowRun(api, claim, status = "in_progress", conclusion = null) {
  api.defaultBranchHead = claim.claimantHeadSha;
  api.workflowRuns.set(`${claim.claimantRunId}/${claim.claimantRunAttempt}`, {
    id: claim.claimantRunId,
    run_attempt: claim.claimantRunAttempt,
    workflow_id: claim.claimantWorkflowId,
    head_sha: claim.claimantHeadSha,
    head_branch: DEFAULT_BRANCH,
    head_repository: { full_name: REPOSITORY },
    repository: { full_name: REPOSITORY },
    event: "workflow_run",
    status,
    conclusion,
  });
}

function makeJournal(runId = 12345, runAttempt = 2) {
  const headCharacter = runId % 2 === 0 ? "c" : "d";
  return {
    schemaVersion: 1,
    runId,
    runAttempt,
    headSha: headCharacter.repeat(40),
    artifactDigest: headCharacter.repeat(64),
    uploadConfigDigest: headCharacter.repeat(64),
    workerName: "sentry-mcp",
    workerTag: WORKER_TAG,
    originalDeploymentId: ORIGINAL_DEPLOYMENT,
    previousVersionId: PREVIOUS_VERSION,
    candidateVersionId: CANDIDATE_VERSION,
    messages: {
      candidate: `candidate ${headCharacter.repeat(16)}`,
      promoted: `promote ${headCharacter.repeat(16)}`,
      restored: `restore ${headCharacter.repeat(16)}`,
    },
  };
}

function jsonResponse(url, status, value, headers = {}) {
  const response = new Response(JSON.stringify(value), { status, headers });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function textResponse(url, status, value, headers = {}) {
  const response = new Response(value, { status, headers });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function withValidRulesets(fetchImpl) {
  const rulesets = makeRulesets();
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(input);
    if (url.pathname === "/repos/acme/widgets/rulesets") {
      return jsonResponse(url.href, 200, makeRulesetSummaries(rulesets));
    }
    const rulesetMatch =
      /^\/repos\/acme\/widgets\/rulesets\/([1-9][0-9]*)$/.exec(url.pathname);
    if (rulesetMatch !== null) {
      const ruleset = rulesets.find(({ id }) => id === Number(rulesetMatch[1]));
      assert.notEqual(ruleset, undefined);
      return jsonResponse(url.href, 200, ruleset);
    }
    return fetchImpl(input, init);
  };
}

class FakeGitHubApi {
  constructor() {
    this.nextObjectId = 1;
    this.blobs = new Map();
    this.trees = new Map();
    this.treeIdsByContent = new Map();
    this.rootFiles = new Map();
    this.commits = new Map();
    this.branchHead = null;
    this.statuses = [];
    this.nextStatusId = 1;
    this.requests = [];
    this.workflowRuns = new Map();
    this.latestWorkflowRuns = new Map();
    this.workflowJobs = new Map();
    this.defaultBranchHead = TRUSTED_SHA;
    this.defaultBranchRef = DEFAULT_BRANCH;
    this.defaultBranchReadCount = 0;
    this.moveDefaultBranchBeforeSecondRead = false;
    this.patchCount = 0;
    this.statusPostCount = 0;
    this.loseNextStatusResponse = false;
    this.loseNextCommittedStatusResponse = false;
    this.loseNextReferenceResponse = false;
    this.rejectNextReferenceBeforeMutation = false;
    this.rejectNextCommittedStatusBeforeMutation = false;
    this.nextStatusResponseOverride = null;
    this.moveRefBeforeNextPatch = false;
    this.claimantWorkflowOverrides = new Map();
    this.repositoryOverrides = {};
    this.rulesets = makeRulesets();

    const workflowBlob = this.createBlob("name: deploy\n");
    const rootTree = this.createRootTree(
      new Map([
        [".github/workflows/deploy.yml", { sha: workflowBlob, mode: "100644" }],
      ]),
    );
    this.commits.set(TRUSTED_SHA, {
      treeSha: rootTree,
      parents: [],
    });
    this.setBootstrapRun();
  }

  setBootstrapRun(runId = 100, runAttempt = 1, options = {}) {
    const headSha = options.headSha ?? TRUSTED_SHA;
    const workflowId = options.workflowId ?? DEPLOY_WORKFLOW_ID;
    const run = {
      id: runId,
      run_attempt: runAttempt,
      workflow_id: workflowId,
      head_sha: headSha,
      head_branch: options.headBranch ?? DEFAULT_BRANCH,
      head_repository: {
        full_name: options.headRepository ?? REPOSITORY,
      },
      repository: { full_name: options.repository ?? REPOSITORY },
      event: options.event ?? "workflow_run",
      status: options.status ?? "completed",
      conclusion: options.conclusion ?? "failure",
    };
    this.workflowRuns.set(`${runId}/${runAttempt}`, run);
    this.latestWorkflowRuns.set(runId, {
      ...run,
      ...(options.latestRun ?? {}),
    });
    this.workflowJobs.set(`${runId}/${runAttempt}`, [
      {
        id: DEPLOY_JOB_ID,
        run_id: runId,
        run_attempt: runAttempt,
        head_sha: headSha,
        name: options.jobName ?? "Deploy production",
        status: options.jobStatus ?? "completed",
        conclusion: options.jobConclusion ?? "failure",
        steps: makeBootstrapSteps(options.stepConclusions),
      },
    ]);
  }

  nextSha() {
    const sha = this.nextObjectId.toString(16).padStart(40, "0");
    this.nextObjectId += 1;
    return sha;
  }

  createBlob(content) {
    const sha = this.nextSha();
    this.blobs.set(sha, Buffer.from(content, "utf8"));
    return sha;
  }

  createRootTree(files) {
    const createDirectory = (directoryFiles) => {
      const directFiles = [];
      const directories = new Map();
      for (const [path, value] of directoryFiles) {
        const separator = path.indexOf("/");
        if (separator === -1) {
          directFiles.push({
            path,
            mode: value.mode,
            type: "blob",
            sha: value.sha,
          });
          continue;
        }
        const directory = path.slice(0, separator);
        const childPath = path.slice(separator + 1);
        const children = directories.get(directory) ?? new Map();
        children.set(childPath, value);
        directories.set(directory, children);
      }
      for (const [path, children] of directories) {
        directFiles.push({
          path,
          mode: "040000",
          type: "tree",
          sha: createDirectory(children),
        });
      }
      directFiles.sort((left, right) => left.path.localeCompare(right.path));
      const treeKey = JSON.stringify(directFiles);
      const existingSha = this.treeIdsByContent.get(treeKey);
      if (existingSha !== undefined) {
        return existingSha;
      }
      const sha = this.nextSha();
      this.trees.set(sha, directFiles);
      this.treeIdsByContent.set(treeKey, sha);
      return sha;
    };

    const rootSha = createDirectory(files);
    this.rootFiles.set(rootSha, new Map(files));
    return rootSha;
  }

  createCommit(treeSha, parents) {
    const sha = this.nextSha();
    this.commits.set(sha, { treeSha, parents });
    return sha;
  }

  setUninitializedBranch() {
    this.branchHead = TRUSTED_SHA;
  }

  mutateBranchFiles(mutator) {
    assert.notEqual(this.branchHead, null);
    const previousHeadSha = this.branchHead;
    const commit = this.commits.get(this.branchHead);
    assert.notEqual(commit, undefined);
    const files = new Map(this.rootFiles.get(commit.treeSha));
    mutator(files);
    const treeSha = this.createRootTree(files);
    this.branchHead = this.createCommit(treeSha, [this.branchHead]);
    return { previousHeadSha, nextHeadSha: this.branchHead };
  }

  response(url, status, value) {
    return jsonResponse(url, status, value);
  }

  referenceResponse(url, sha) {
    return this.response(url, 200, {
      ref: BRANCH_REF,
      object: { type: "commit", sha },
    });
  }

  async fetch(input, init = {}) {
    const url = input instanceof URL ? input : new URL(input);
    const method = init.method ?? "GET";
    assert.equal(url.origin, API_ORIGIN);
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers["X-GitHub-Api-Version"], "2022-11-28");
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    this.requests.push({ method, path: url.pathname, body });

    const prefix = "/repos/acme/widgets";
    assert.equal(url.pathname.startsWith(prefix), true);
    const path = url.pathname.slice(prefix.length);

    if (method === "GET" && path === "/rulesets") {
      assert.equal(url.searchParams.get("includes_parents"), "false");
      assert.equal(url.searchParams.get("targets"), "branch");
      assert.equal(url.searchParams.get("per_page"), "100");
      return this.response(url.href, 200, makeRulesetSummaries(this.rulesets));
    }

    const rulesetMatch = /^\/rulesets\/([1-9][0-9]*)$/.exec(path);
    if (method === "GET" && rulesetMatch !== null) {
      const ruleset = this.rulesets.find(
        ({ id }) => id === Number(rulesetMatch[1]),
      );
      assert.notEqual(ruleset, undefined);
      return this.response(url.href, 200, ruleset);
    }

    if (method === "GET" && path === "") {
      return this.response(url.href, 200, {
        full_name: REPOSITORY,
        default_branch: DEFAULT_BRANCH,
        ...this.repositoryOverrides,
      });
    }

    if (method === "GET" && path === "/actions/workflows/deploy.yml") {
      return this.response(url.href, 200, {
        id: DEPLOY_WORKFLOW_ID,
        path: ".github/workflows/deploy.yml",
        state: "active",
      });
    }

    const workflowMatch = /^\/actions\/workflows\/([1-9][0-9]*)$/.exec(path);
    if (method === "GET" && workflowMatch !== null) {
      const workflowId = Number(workflowMatch[1]);
      return this.response(url.href, 200, {
        id: workflowId,
        path: ".github/workflows/recover-cloudflare-deployment.yml",
        state: "active",
        ...this.claimantWorkflowOverrides.get(workflowId),
      });
    }

    if (method === "GET" && path === `/git/ref/heads/${DEFAULT_BRANCH}`) {
      this.defaultBranchReadCount += 1;
      if (
        this.moveDefaultBranchBeforeSecondRead &&
        this.defaultBranchReadCount === 2
      ) {
        this.defaultBranchHead = EXTERNAL_SHA;
      }
      return this.response(url.href, 200, {
        ref: `refs/heads/${this.defaultBranchRef}`,
        object: { type: "commit", sha: this.defaultBranchHead },
      });
    }

    if (
      method === "GET" &&
      path === "/git/ref/heads/cloudflare-deployment-journal"
    ) {
      return this.branchHead === null
        ? this.response(url.href, 404, { message: "Not Found" })
        : this.referenceResponse(url.href, this.branchHead);
    }

    if (method === "GET" && path === `/commits/${TRUSTED_SHA}/statuses`) {
      assert.equal(url.searchParams.get("per_page"), "100");
      const page = Number(url.searchParams.get("page"));
      const start = (page - 1) * 100;
      return this.response(
        url.href,
        200,
        [...this.statuses].reverse().slice(start, start + 100),
      );
    }

    const comparisonMatch =
      /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(path);
    if (method === "GET" && comparisonMatch !== null) {
      assert.equal(url.searchParams.get("per_page"), "1");
      const baseSha = comparisonMatch[1];
      const headSha = comparisonMatch[2];
      let currentSha = headSha;
      let commitCount = 0;
      const seen = new Set();
      while (currentSha !== baseSha && !seen.has(currentSha)) {
        seen.add(currentSha);
        const commit = this.commits.get(currentSha);
        if (commit === undefined || commit.parents.length !== 1) {
          break;
        }
        commitCount += 1;
        currentSha = commit.parents[0];
      }
      const isAhead = currentSha === baseSha;
      const requestedPage = Number(url.searchParams.get("page"));
      return this.response(url.href, 200, {
        status: isAhead ? "ahead" : "diverged",
        ahead_by: commitCount,
        behind_by: 0,
        total_commits: commitCount,
        base_commit: { sha: baseSha },
        merge_base_commit: { sha: isAhead ? baseSha : TRUSTED_SHA },
        commits:
          isAhead && requestedPage === commitCount ? [{ sha: headSha }] : [],
      });
    }

    const commitMatch = /^\/git\/commits\/([0-9a-f]{40})$/.exec(path);
    if (method === "GET" && commitMatch !== null) {
      const sha = commitMatch[1];
      const commit = this.commits.get(sha);
      if (commit === undefined) {
        return this.response(url.href, 404, { message: "Not Found" });
      }
      return this.response(url.href, 200, {
        sha,
        tree: { sha: commit.treeSha },
        parents: commit.parents.map((parentSha) => ({ sha: parentSha })),
      });
    }

    const treeMatch = /^\/git\/trees\/([0-9a-f]{40})$/.exec(path);
    if (method === "GET" && treeMatch !== null) {
      const sha = treeMatch[1];
      const tree = this.trees.get(sha);
      if (tree === undefined) {
        return this.response(url.href, 404, { message: "Not Found" });
      }
      return this.response(url.href, 200, {
        sha,
        tree,
        truncated: false,
      });
    }

    const blobMatch = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(path);
    if (method === "GET" && blobMatch !== null) {
      const sha = blobMatch[1];
      const blob = this.blobs.get(sha);
      if (blob === undefined) {
        return this.response(url.href, 404, { message: "Not Found" });
      }
      return this.response(url.href, 200, {
        sha,
        encoding: "base64",
        size: blob.byteLength,
        content: blob.toString("base64"),
      });
    }

    const runAttemptMatch =
      /^\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/.exec(path);
    if (method === "GET" && runAttemptMatch !== null) {
      const key = `${runAttemptMatch[1]}/${runAttemptMatch[2]}`;
      const run = this.workflowRuns.get(key);
      return run === undefined
        ? this.response(url.href, 404, { message: "Not Found" })
        : this.response(url.href, 200, run);
    }

    const latestRunMatch = /^\/actions\/runs\/([1-9][0-9]*)$/.exec(path);
    if (method === "GET" && latestRunMatch !== null) {
      const run = this.latestWorkflowRuns.get(Number(latestRunMatch[1]));
      return run === undefined
        ? this.response(url.href, 404, { message: "Not Found" })
        : this.response(url.href, 200, run);
    }

    const jobsMatch =
      /^\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)\/jobs$/.exec(
        path,
      );
    if (method === "GET" && jobsMatch !== null) {
      assert.equal(url.searchParams.get("per_page"), "100");
      const key = `${jobsMatch[1]}/${jobsMatch[2]}`;
      const jobs = this.workflowJobs.get(key);
      return jobs === undefined
        ? this.response(url.href, 404, { message: "Not Found" })
        : this.response(url.href, 200, {
            total_count: jobs.length,
            jobs,
          });
    }

    if (method === "POST" && path === "/git/blobs") {
      assert.equal(body.encoding, "base64");
      const content = Buffer.from(body.content, "base64");
      const sha = this.nextSha();
      this.blobs.set(sha, content);
      return this.response(url.href, 201, { sha });
    }

    if (method === "POST" && path === "/git/trees") {
      const baseFiles = this.rootFiles.get(body.base_tree);
      if (baseFiles === undefined) {
        return this.response(url.href, 422, { message: "Invalid base tree" });
      }
      const files = new Map(baseFiles);
      for (const entry of body.tree) {
        assert.equal(entry.mode, "100644");
        assert.equal(entry.type, "blob");
        files.set(entry.path, { sha: entry.sha, mode: entry.mode });
      }
      const sha = this.createRootTree(files);
      return this.response(url.href, 201, {
        sha,
        tree: this.trees.get(sha),
        truncated: false,
      });
    }

    if (method === "POST" && path === "/git/commits") {
      assert.equal(this.trees.has(body.tree), true);
      assert.equal(body.parents.length, 1);
      const sha = this.createCommit(body.tree, body.parents);
      return this.response(url.href, 201, {
        sha,
        tree: { sha: body.tree },
        parents: body.parents.map((parentSha) => ({ sha: parentSha })),
      });
    }

    if (method === "POST" && path === `/statuses/${TRUSTED_SHA}`) {
      this.statusPostCount += 1;
      if (
        this.rejectNextCommittedStatusBeforeMutation &&
        body.context.endsWith("/committed")
      ) {
        this.rejectNextCommittedStatusBeforeMutation = false;
        return this.response(url.href, 503, { message: "Unavailable" });
      }
      const status = {
        id: this.nextStatusId,
        sha: TRUSTED_SHA,
        state: body.state,
        target_url: body.target_url,
        description: body.description,
        context: body.context,
      };
      this.nextStatusId += 1;
      this.statuses.push(status);
      if (this.loseNextStatusResponse) {
        this.loseNextStatusResponse = false;
        throw new Error("simulated lost status response");
      }
      if (
        this.loseNextCommittedStatusResponse &&
        body.context.endsWith("/committed")
      ) {
        this.loseNextCommittedStatusResponse = false;
        throw new Error("simulated lost committed status response");
      }
      const response = this.nextStatusResponseOverride ?? status;
      this.nextStatusResponseOverride = null;
      return this.response(url.href, 201, response);
    }

    if (method === "POST" && path === "/git/refs") {
      if (this.rejectNextReferenceBeforeMutation) {
        this.rejectNextReferenceBeforeMutation = false;
        return this.response(url.href, 503, { message: "Unavailable" });
      }
      if (this.branchHead !== null) {
        return this.response(url.href, 422, { message: "Reference exists" });
      }
      assert.equal(body.ref, BRANCH_REF);
      assert.equal(this.commits.has(body.sha), true);
      this.branchHead = body.sha;
      if (this.loseNextReferenceResponse) {
        this.loseNextReferenceResponse = false;
        throw new Error("simulated lost reference response");
      }
      return this.response(url.href, 201, {
        ref: body.ref,
        object: { type: "commit", sha: body.sha },
      });
    }

    if (
      method === "PATCH" &&
      path === "/git/refs/heads/cloudflare-deployment-journal"
    ) {
      this.patchCount += 1;
      assert.equal(body.force, false);
      const proposedCommit = this.commits.get(body.sha);
      assert.notEqual(proposedCommit, undefined);
      if (this.rejectNextReferenceBeforeMutation) {
        this.rejectNextReferenceBeforeMutation = false;
        return this.response(url.href, 503, { message: "Unavailable" });
      }
      if (this.moveRefBeforeNextPatch) {
        this.moveRefBeforeNextPatch = false;
        const currentCommit = this.commits.get(this.branchHead);
        const externalTree = currentCommit.treeSha;
        this.commits.set(EXTERNAL_SHA, {
          treeSha: externalTree,
          parents: [this.branchHead],
        });
        this.rootFiles.set(
          externalTree,
          new Map(this.rootFiles.get(externalTree)),
        );
        this.branchHead = EXTERNAL_SHA;
      }
      if (
        proposedCommit.parents.length !== 1 ||
        proposedCommit.parents[0] !== this.branchHead
      ) {
        return this.response(url.href, 422, {
          message: "Update is not a fast forward",
        });
      }
      this.branchHead = body.sha;
      if (this.loseNextReferenceResponse) {
        this.loseNextReferenceResponse = false;
        throw new Error("simulated lost reference response");
      }
      return this.referenceResponse(url.href, body.sha);
    }

    throw new Error(`Unexpected fake GitHub request: ${method} ${path}`);
  }
}

function createStore(api, token = TOKEN, maxHistoryCommits, maxStatusScan) {
  return createCloudflareJournalStore({
    expectedAppId: JOURNAL_APP_ID,
    fetchImpl: api.fetch.bind(api),
    hmacKey: HMAC_KEY,
    maxHistoryCommits,
    maxStatusScan,
    repository: REPOSITORY,
    token,
    trustedSha: TRUSTED_SHA,
  });
}

function cliEnv(overrides = {}) {
  return {
    CLOUDFLARE_JOURNAL_APP_ID: String(JOURNAL_APP_ID),
    CLOUDFLARE_JOURNAL_HMAC_KEY: HMAC_KEY,
    CLOUDFLARE_JOURNAL_TRUSTED_SHA: TRUSTED_SHA,
    GH_TOKEN: TOKEN,
    GITHUB_REPOSITORY: REPOSITORY,
    ...overrides,
  };
}

async function bootstrap(api, runId = 100, runAttempt = 1) {
  api.setBootstrapRun(runId, runAttempt);
  return createStore(api).bootstrap(runId, runAttempt);
}

function appendReconciliationRecord(api, record) {
  const blobSha = api.createBlob(`${JSON.stringify(record)}\n`);
  const suffix = record.status === "claimed" ? "claim" : "completion";
  const immutablePath = `.github/cloudflare-deployment-journals/reconciliations/${record.targetRunId}-${record.targetRunAttempt}-${record.claimantRunId}-${record.claimantRunAttempt}-${record.action}-${suffix}.json`;
  const transition = api.mutateBranchFiles((files) => {
    files.set(immutablePath, { sha: blobSha, mode: "100644" });
    files.set(".github/cloudflare-deployment-journals/reconciliation.json", {
      sha: blobSha,
      mode: "100644",
    });
  });
  addAuthenticatedAnchor(api, {
    ...transition,
    transition: record.status === "claimed" ? "claim" : "complete",
    recordPath: immutablePath,
    recordBlobSha: blobSha,
  });
  return blobSha;
}

function appendCompletedRestoreCycles(api, journal, count) {
  const currentFiles = api.rootFiles.get(
    api.commits.get(api.branchHead).treeSha,
  );
  let previousReconciliationSha =
    currentFiles.get(
      ".github/cloudflare-deployment-journals/reconciliation.json",
    )?.sha ?? null;
  for (let index = 0; index < count; index += 1) {
    const claim = {
      schemaVersion: 1,
      targetRunId: journal.runId,
      targetRunAttempt: journal.runAttempt,
      claimantRunId: 1_000 + index,
      claimantRunAttempt: 1,
      claimantWorkflowId: 300,
      claimantHeadSha: CLAIMANT_HEAD,
      action: "restore",
      takeover: null,
      status: "claimed",
      previousReconciliationSha,
    };
    const claimSha = appendReconciliationRecord(api, claim);
    previousReconciliationSha = appendReconciliationRecord(api, {
      ...claim,
      status: "completed",
      previousReconciliationSha: claimSha,
      claimSha,
      result: { state: "unchanged", decision: "unchanged" },
    });
  }
  return previousReconciliationSha;
}

describe("Cloudflare deployment journal store", () => {
  it("accepts only the exact active writer and immutable ruleset pair", async () => {
    const acceptedApi = new FakeGitHubApi();
    await assert.doesNotReject(createStore(acceptedApi).getState());

    const unrelatedApi = new FakeGitHubApi();
    unrelatedApi.rulesets.push({
      ...makeRulesets()[1],
      id: 3,
      name: "Protect main",
      conditions: {
        ref_name: { include: ["refs/heads/main"], exclude: [] },
      },
    });
    await assert.doesNotReject(createStore(unrelatedApi).getState());

    const duplicateSummaryApi = new FakeGitHubApi();
    duplicateSummaryApi.rulesets.push({
      ...makeRulesets()[1],
      id: 1,
      name: "Duplicate ID",
      conditions: {
        ref_name: { include: ["refs/heads/main"], exclude: [] },
      },
    });
    await assert.rejects(
      createStore(duplicateSummaryApi).getState(),
      /ruleset summaries contain duplicate IDs/,
    );

    const paginatedApi = new FakeGitHubApi();
    paginatedApi.rulesets = Array.from({ length: 100 }, (_, index) => ({
      ...makeRulesets()[1],
      id: index + 1,
      name: `Ruleset ${index + 1}`,
      conditions: {
        ref_name: { include: ["refs/heads/main"], exclude: [] },
      },
    }));
    await assert.rejects(
      createStore(paginatedApi).getState(),
      /too many branch rulesets to verify without pagination/,
    );

    const cases = [
      ["absent pair", () => [], /must have exactly two repository rulesets/],
      [
        "inactive writer",
        () => {
          const rulesets = makeRulesets();
          rulesets[0].enforcement = "evaluate";
          return rulesets;
        },
        /is not active for the journal branch/,
      ],
      [
        "malformed writer rule",
        () => {
          const rulesets = makeRulesets();
          rulesets[0].rules[1].parameters = {};
          return rulesets;
        },
        /update rule parameters has an invalid shape/,
      ],
      [
        "wrong target",
        () => {
          const rulesets = makeRulesets();
          rulesets[1].conditions.ref_name.include = ["refs/heads/other"];
          return rulesets;
        },
        /must have exactly two repository rulesets/,
      ],
      [
        "wrong App",
        () => makeRulesets(JOURNAL_APP_ID + 1),
        /bypass actor is not the expected GitHub App/,
      ],
      [
        "immutable bypass",
        () => {
          const rulesets = makeRulesets();
          rulesets[1].bypass_actors.push({
            actor_id: JOURNAL_APP_ID,
            actor_type: "Integration",
            bypass_mode: "always",
          });
          return rulesets;
        },
        /immutable ruleset must not allow bypass actors/,
      ],
      [
        "extra ruleset",
        () => {
          const rulesets = makeRulesets();
          rulesets.push({ ...rulesets[1], id: 3 });
          return rulesets;
        },
        /must have exactly two repository rulesets/,
      ],
    ];

    for (const [name, makeInvalidRulesets, pattern] of cases) {
      const api = new FakeGitHubApi();
      api.rulesets = makeInvalidRulesets();
      await assert.rejects(createStore(api).getState(), pattern, name);
      assert.equal(
        api.requests.some(
          ({ method }) => method === "POST" || method === "PATCH",
        ),
        false,
        name,
      );
      assert.deepEqual(api.requests[0], {
        method: "GET",
        path: "/repos/acme/widgets/rulesets",
        body: undefined,
      });
    }
  });

  it("distinguishes absent, uninitialized, and explicitly initialized state", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);

    assert.deepEqual(await store.getState(), { state: "absent" });

    api.setUninitializedBranch();
    assert.deepEqual(await store.getState(), {
      state: "uninitialized",
      branchHeadSha: TRUSTED_SHA,
    });
    await assert.rejects(
      store.append(makeJournal(), TRUSTED_SHA),
      /uninitialized; bootstrap is required/,
    );

    api.branchHead = null;
    const initialized = await store.bootstrap(100, 1);
    assert.deepEqual(await store.getState(), {
      state: "initialized",
      branchHeadSha: initialized.branchHeadSha,
      bootstrap: {
        schemaVersion: 1,
        repository: REPOSITORY,
        trustedSha: TRUSTED_SHA,
        runId: 100,
        runAttempt: 1,
      },
    });
    await assert.rejects(
      store.bootstrap(100, 1),
      /journal branch already exists/,
    );

    const createTree = api.requests.find(
      ({ method, path }) => method === "POST" && path.endsWith("/git/trees"),
    );
    assert.deepEqual(createTree.body.tree, [
      {
        path: ".github/cloudflare-deployment-journals/bootstrap.json",
        mode: "100644",
        type: "blob",
        sha: createTree.body.tree[0].sha,
      },
    ]);
    const requestPaths = new Set(
      api.requests
        .filter(({ method }) => method === "GET")
        .map(({ path }) => path),
    );
    for (const path of [
      "/repos/acme/widgets",
      "/repos/acme/widgets/actions/workflows/deploy.yml",
      "/repos/acme/widgets/actions/runs/100/attempts/1",
      "/repos/acme/widgets/actions/runs/100",
      "/repos/acme/widgets/git/ref/heads/main",
      "/repos/acme/widgets/actions/runs/100/attempts/1/jobs",
    ]) {
      assert.equal(requestPaths.has(path), true, path);
    }
  });

  it("rejects false or post-mutation bootstrap provenance", async () => {
    const staleApi = new FakeGitHubApi();
    staleApi.defaultBranchHead = EXTERNAL_SHA;
    await assert.rejects(
      createStore(staleApi).bootstrap(100, 1),
      /not at the current default-branch head/,
    );
    assert.equal(staleApi.branchHead, null);

    const staleAttemptApi = new FakeGitHubApi();
    staleAttemptApi.setBootstrapRun(100, 1, {
      latestRun: { run_attempt: 2 },
    });
    await assert.rejects(
      createStore(staleAttemptApi).bootstrap(100, 1),
      /run_attempt differs from its latest attempt/,
    );
    assert.equal(staleAttemptApi.branchHead, null);

    const racedHeadApi = new FakeGitHubApi();
    racedHeadApi.moveDefaultBranchBeforeSecondRead = true;
    await assert.rejects(
      createStore(racedHeadApi).bootstrap(100, 1),
      /default branch changed while bootstrapping/,
    );
    assert.equal(racedHeadApi.branchHead, null);

    const wrongGateApi = new FakeGitHubApi();
    wrongGateApi.setBootstrapRun(100, 1, {
      stepConclusions: {
        "Reconcile the newest durable deployment journal": "success",
      },
    });
    await assert.rejects(
      createStore(wrongGateApi).bootstrap(100, 1),
      /did not fail at the pre-mutation journal gate/,
    );
    assert.equal(wrongGateApi.branchHead, null);

    const laterMutationApi = new FakeGitHubApi();
    laterMutationApi.setBootstrapRun(100, 1, {
      stepConclusions: { "Build production artifact once": "success" },
    });
    await assert.rejects(
      createStore(laterMutationApi).bootstrap(100, 1),
      /ran later step 'Build production artifact once'/,
    );
    assert.equal(laterMutationApi.branchHead, null);
  });

  it("appends immutable and latest paths in one commit and never overwrites a run", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const journal = makeJournal();
    const beforeAppend = api.requests.length;

    const expectedBranchHead = api.branchHead;
    const appended = await store.append(journal, expectedBranchHead);
    assert.deepEqual(await store.getState(), {
      state: "latest",
      branchHeadSha: appended.branchHeadSha,
      bootstrap: {
        schemaVersion: 1,
        repository: REPOSITORY,
        trustedSha: TRUSTED_SHA,
        runId: 100,
        runAttempt: 1,
      },
      journal,
    });

    const appendRequests = api.requests.slice(beforeAppend);
    const treeRequest = appendRequests.find(
      ({ method, path }) => method === "POST" && path.endsWith("/git/trees"),
    );
    assert.deepEqual(treeRequest.body.tree, [
      {
        path: ".github/cloudflare-deployment-journals/12345-2.json",
        mode: "100644",
        type: "blob",
        sha: treeRequest.body.tree[0].sha,
      },
      {
        path: ".github/cloudflare-deployment-journals/latest.json",
        mode: "100644",
        type: "blob",
        sha: treeRequest.body.tree[0].sha,
      },
    ]);
    const refRequest = appendRequests.find(({ method }) => method === "PATCH");
    assert.deepEqual(refRequest.body, {
      sha: appended.branchHeadSha,
      force: false,
    });
    const statusRequests = appendRequests.filter(
      ({ method, path }) =>
        method === "POST" &&
        path === `/repos/acme/widgets/statuses/${TRUSTED_SHA}`,
    );
    assert.equal(statusRequests.length, 2);
    assert.match(statusRequests[0].body.context, /\/prepared$/);
    assert.equal(statusRequests[0].body.state, "pending");
    assert.match(statusRequests[1].body.context, /\/committed$/);
    assert.equal(statusRequests[1].body.state, "success");
    for (const request of statusRequests) {
      assert.equal(
        new URL(request.body.target_url).pathname,
        `/${REPOSITORY}/commit/${appended.branchHeadSha}`,
      );
      assert.match(request.body.description, /^hmac-sha256:v1:[0-9a-f]{64}$/);
    }

    const requestCount = api.requests.length;
    await assert.rejects(
      store.append(journal, appended.branchHeadSha),
      /deployment journal 12345\/2 already exists/,
    );
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
  });

  it("observes lost status and ref responses without duplicating a transition", async () => {
    for (const failure of [
      "prepared-status",
      "reference",
      "committed-status",
    ]) {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      const statusesBefore = api.statuses.length;
      const commitsBefore = api.commits.size;
      if (failure === "prepared-status") {
        api.loseNextStatusResponse = true;
      } else if (failure === "reference") {
        api.loseNextReferenceResponse = true;
      } else {
        api.loseNextCommittedStatusResponse = true;
      }
      await createStore(api).append(makeJournal(), api.branchHead);
      assert.equal(api.statuses.length, statusesBefore + 2, failure);
      assert.equal(api.commits.size, commitsBefore + 1, failure);
      assert.equal(
        (await createStore(api).getState()).state,
        "latest",
        failure,
      );
    }
  });

  it("settles one trailing prepare after restart without creating another commit", async () => {
    {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      const previousHead = api.branchHead;
      api.rejectNextReferenceBeforeMutation = true;
      await assert.rejects(
        createStore(api).append(makeJournal(), previousHead),
        /update journal branch failed with HTTP 503/,
      );
      assert.equal(api.branchHead, previousHead);
      assert.match(api.statuses.at(-1).context, /\/prepared$/);
      const commitCount = api.commits.size;
      assert.equal((await createStore(api).getState()).state, "latest");
      assert.equal(api.commits.size, commitCount);
      assert.match(api.statuses.at(-1).context, /\/committed$/);
    }

    {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      api.rejectNextCommittedStatusBeforeMutation = true;
      await assert.rejects(
        createStore(api).append(makeJournal(), api.branchHead),
        /create journal committed status failed with HTTP 503/,
      );
      const candidateHead = api.branchHead;
      const commitCount = api.commits.size;
      assert.match(api.statuses.at(-1).context, /\/prepared$/);
      const state = await createStore(api).getState();
      assert.equal(state.branchHeadSha, candidateHead);
      assert.equal(api.commits.size, commitCount);
      assert.match(api.statuses.at(-1).context, /\/committed$/);
    }

    {
      const api = new FakeGitHubApi();
      api.rejectNextReferenceBeforeMutation = true;
      await assert.rejects(
        createStore(api).bootstrap(100, 1),
        /create journal branch failed with HTTP 503/,
      );
      assert.equal(api.branchHead, null);
      const commitCount = api.commits.size;
      const state = await createStore(api).getState();
      assert.equal(state.state, "initialized");
      assert.equal(api.commits.size, commitCount);
    }
  });

  it("rejects every tampered authenticated status field before mutation", async () => {
    const cases = [
      [
        "context",
        (status) => ({ ...status, context: `${status.context}-tampered` }),
        /does not match its canonical record/,
      ],
      [
        "state",
        (status) => ({ ...status, state: "error" }),
        /does not match its canonical record/,
      ],
      [
        "URL",
        (status) => {
          const url = new URL(status.target_url);
          url.pathname = `/other/repository/commit/${readStatusRecord(status).nextHeadSha}`;
          return { ...status, target_url: url.href };
        },
        /does not match its canonical record/,
      ],
      [
        "phase",
        (status) =>
          makeAuthenticatedStatus(status.id, {
            ...readStatusRecord(status),
            phase: "unexpected",
          }),
        /phase is invalid/,
      ],
      [
        "repository",
        (status) =>
          makeAuthenticatedStatus(status.id, {
            ...readStatusRecord(status),
            repository: "other/repository",
          }),
        /repository does not match/,
      ],
      [
        "App ID",
        (status) =>
          makeAuthenticatedStatus(status.id, {
            ...readStatusRecord(status),
            writerAppId: JOURNAL_APP_ID + 1,
          }),
        /writer App ID does not match/,
      ],
      [
        "trusted SHA",
        (status) =>
          makeAuthenticatedStatus(status.id, {
            ...readStatusRecord(status),
            trustedSha: EXTERNAL_SHA,
          }),
        /trusted SHA does not match/,
      ],
      [
        "transition",
        (status) =>
          makeAuthenticatedStatus(status.id, {
            ...readStatusRecord(status),
            transition: "claim",
          }),
        /conflicting phase records/,
      ],
      [
        "record path",
        (status) =>
          makeAuthenticatedStatus(status.id, {
            ...readStatusRecord(status),
            recordPath: ".github/cloudflare-deployment-journals/99999-1.json",
          }),
        /conflicting phase records/,
      ],
      [
        "blob SHA",
        (status) =>
          makeAuthenticatedStatus(status.id, {
            ...readStatusRecord(status),
            recordBlobSha: EXTERNAL_SHA,
          }),
        /conflicting phase records/,
      ],
    ];

    for (const [name, tamper, pattern] of cases) {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      await createStore(api).append(makeJournal(), api.branchHead);
      api.statuses[api.statuses.length - 1] = tamper(api.statuses.at(-1));
      const requestCount = api.requests.length;
      await assert.rejects(createStore(api).getState(), pattern, name);
      assert.equal(
        api.requests
          .slice(requestCount)
          .some(({ method }) => method === "POST" || method === "PATCH"),
        false,
        name,
      );
    }
  });

  it("ignores invalid-MAC noise but rejects duplicate, conflicting, and gapped authenticated statuses", async () => {
    const invalidMacApi = new FakeGitHubApi();
    const invalidRecord = {
      schemaVersion: 1,
      repository: REPOSITORY,
      writerAppId: JOURNAL_APP_ID,
      trustedSha: TRUSTED_SHA,
      sequence: 1,
      phase: "prepared",
      transition: "bootstrap",
      previousHeadSha: TRUSTED_SHA,
      nextHeadSha: EXTERNAL_SHA,
      recordPath: ".github/cloudflare-deployment-journals/bootstrap.json",
      recordBlobSha: TRUSTED_SHA,
    };
    const invalidStatus = makeAuthenticatedStatus(1, invalidRecord);
    invalidStatus.description = `${STATUS_DESCRIPTION_PREFIX}${"0".repeat(64)}`;
    invalidMacApi.statuses.push(invalidStatus);
    assert.deepEqual(await createStore(invalidMacApi).getState(), {
      state: "absent",
    });

    const duplicateApi = new FakeGitHubApi();
    await bootstrap(duplicateApi);
    duplicateApi.statuses.push({
      ...duplicateApi.statuses[0],
      id: duplicateApi.nextStatusId,
    });
    duplicateApi.nextStatusId += 1;
    await assert.rejects(
      createStore(duplicateApi).getState(),
      /conflicting 1\/prepared statuses/,
    );

    const conflictApi = new FakeGitHubApi();
    await bootstrap(conflictApi);
    const prepared = {
      ...readStatusRecord(conflictApi.statuses.at(-1)),
      sequence: 2,
      phase: "prepared",
      transition: "append",
      previousHeadSha: conflictApi.branchHead,
      nextHeadSha: EXTERNAL_SHA,
      recordPath: ".github/cloudflare-deployment-journals/200-1.json",
    };
    conflictApi.statuses.push(
      makeAuthenticatedStatus(conflictApi.nextStatusId, prepared),
      makeAuthenticatedStatus(conflictApi.nextStatusId + 1, {
        ...prepared,
        nextHeadSha: "c".repeat(40),
      }),
    );
    conflictApi.nextStatusId += 2;
    await assert.rejects(
      createStore(conflictApi).getState(),
      /conflicting 2\/prepared statuses/,
    );

    const gapApi = new FakeGitHubApi();
    await bootstrap(gapApi);
    gapApi.statuses.push(
      makeAuthenticatedStatus(gapApi.nextStatusId, {
        ...readStatusRecord(gapApi.statuses.at(-1)),
        sequence: 3,
        phase: "prepared",
        transition: "append",
        previousHeadSha: gapApi.branchHead,
        nextHeadSha: EXTERNAL_SHA,
        recordPath: ".github/cloudflare-deployment-journals/300-1.json",
      }),
    );
    gapApi.nextStatusId += 1;
    await assert.rejects(
      createStore(gapApi).getState(),
      /missing prepared sequence 2/,
    );

    const committedOnlyApi = new FakeGitHubApi();
    committedOnlyApi.statuses.push(
      makeAuthenticatedStatus(committedOnlyApi.nextStatusId, {
        ...invalidRecord,
        phase: "committed",
      }),
    );
    await assert.rejects(
      createStore(committedOnlyApi).getState(),
      /missing prepared sequence 1/,
    );
  });

  it("rejects deleted, rewound, and coherently rewritten refs even with perfect rulesets", async () => {
    for (const mutation of ["deleted", "rewound", "rewritten"]) {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      await createStore(api).append(makeJournal(), api.branchHead);
      const latestCommit = api.commits.get(api.branchHead);
      if (mutation === "deleted") {
        api.branchHead = null;
      } else if (mutation === "rewound") {
        api.branchHead = latestCommit.parents[0];
      } else {
        const rewrittenBootstrap = api.createCommit(
          api.commits.get(latestCommit.parents[0]).treeSha,
          [TRUSTED_SHA],
        );
        api.branchHead = api.createCommit(latestCommit.treeSha, [
          rewrittenBootstrap,
        ]);
      }
      await assert.rejects(
        createStore(api).getState(),
        mutation === "deleted"
          ? /deleted after an authenticated commit/
          : /does not match the authenticated anchor ledger/,
        mutation,
      );
    }
  });

  it("fails closed when unrelated status spam exhausts the bounded scan", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    for (let index = 0; index < 13; index += 1) {
      api.statuses.push({
        id: api.nextStatusId,
        sha: TRUSTED_SHA,
        state: "success",
        target_url: `https://example.invalid/${index}`,
        description: "unrelated",
        context: `unrelated/${index}`,
      });
      api.nextStatusId += 1;
    }
    await assert.rejects(
      createStore(api, TOKEN, 7, 14).getState(),
      /status scan exceeds the 14-status limit/,
    );
  });

  it("rejects a mismatched create-status response before advancing the ref", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const previousHead = api.branchHead;
    api.nextStatusResponseOverride = {
      id: 999,
      sha: TRUSTED_SHA,
      state: "success",
      target_url: "https://example.invalid/",
      description: "mismatched",
      context: "mismatched",
    };
    await assert.rejects(
      createStore(api).append(makeJournal(), previousHead),
      /create prepared status response does not match the request/,
    );
    assert.equal(api.branchHead, previousHead);
    assert.match(api.statuses.at(-1).context, /\/prepared$/);
  });

  it("requires the first journal run ID to advance beyond bootstrap", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api, 100, 1);
    const store = createStore(api);

    for (const runId of [100, 99]) {
      const requestCount = api.requests.length;
      await assert.rejects(
        store.append(makeJournal(runId, 2), api.branchHead),
        /must advance the bootstrap run ID/,
      );
      assert.equal(
        api.requests
          .slice(requestCount)
          .some(({ method }) => method === "POST" || method === "PATCH"),
        false,
      );
    }
    assert.equal((await store.getState()).state, "initialized");
  });

  it("claims reconciliation before mutation and completes it with observed state", async () => {
    const api = new FakeGitHubApi();
    const initialized = await bootstrap(api);
    const store = createStore(api);
    const journal = makeJournal();
    const appended = await store.append(journal, initialized.branchHeadSha);
    const claim = makeClaim(journal);
    setWorkflowRun(api, claim);

    const claimed = await store.claim(claim, appended.branchHeadSha);
    assert.deepEqual((await store.getState()).reconciliation, {
      ...makeClaim(journal),
      status: "claimed",
      previousReconciliationSha: null,
    });
    await assert.rejects(
      store.append(makeJournal(12346, 1), claimed.branchHeadSha),
      /reconciliation is still claimed/,
    );
    await assert.rejects(
      store.complete(
        {
          schemaVersion: 1,
          claimantRunId: 200,
          claimantRunAttempt: 1,
          result: { state: "promoted", decision: "restore" },
        },
        claimed.branchHeadSha,
      ),
      /does not prove the claimed action succeeded/,
    );

    const completed = await store.complete(
      {
        schemaVersion: 1,
        claimantRunId: 200,
        claimantRunAttempt: 1,
        result: { state: "unchanged", decision: "unchanged" },
      },
      claimed.branchHeadSha,
    );
    const state = await store.getState();
    assert.equal(state.branchHeadSha, completed.branchHeadSha);
    assert.deepEqual(state.reconciliation.result, {
      state: "unchanged",
      decision: "unchanged",
    });

    const files = api.rootFiles.get(api.commits.get(api.branchHead).treeSha);
    assert.equal(
      files.has(
        ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-claim.json",
      ),
      true,
    );
    assert.equal(
      files.has(
        ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-completion.json",
      ),
      true,
    );
  });

  it("idempotently reuses an exact claim and lets the same claimant move only from verification to restoration", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const journal = makeJournal();
    const appended = await store.append(journal, api.branchHead);
    const verificationClaim = makeClaim(journal, {
      action: "verify-promoted",
    });
    setWorkflowRun(api, verificationClaim);

    const verification = await store.claim(
      verificationClaim,
      appended.branchHeadSha,
    );
    const requestCount = api.requests.length;
    const repeated = await store.claim(
      verificationClaim,
      verification.branchHeadSha,
    );
    assert.equal(repeated.branchHeadSha, verification.branchHeadSha);
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );

    const restoreClaim = { ...verificationClaim, action: "restore" };
    const restoration = await store.claim(
      restoreClaim,
      verification.branchHeadSha,
    );
    assert.equal(
      restoration.reconciliation.previousReconciliationSha,
      api.rootFiles
        .get(api.commits.get(verification.branchHeadSha).treeSha)
        .get(".github/cloudflare-deployment-journals/reconciliation.json").sha,
    );
    const files = api.rootFiles.get(api.commits.get(api.branchHead).treeSha);
    assert.equal(
      files.has(
        ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-verify-promoted-claim.json",
      ),
      true,
    );
    assert.equal(
      files.has(
        ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-claim.json",
      ),
      true,
    );

    const completed = await store.complete(
      {
        schemaVersion: 1,
        claimantRunId: restoreClaim.claimantRunId,
        claimantRunAttempt: restoreClaim.claimantRunAttempt,
        result: { state: "restored", decision: "restored" },
      },
      restoration.branchHeadSha,
    );
    assert.equal(
      completed.reconciliation.previousReconciliationSha,
      completed.reconciliation.claimSha,
    );
  });

  it("rejects every other active same-claimant action replacement without mutation", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const journal = makeJournal();
    const appended = await store.append(journal, api.branchHead);
    const restoreClaim = makeClaim(journal);
    setWorkflowRun(api, restoreClaim);
    const restoration = await store.claim(restoreClaim, appended.branchHeadSha);
    const requestCount = api.requests.length;

    await assert.rejects(
      store.claim(
        { ...restoreClaim, action: "verify-promoted" },
        restoration.branchHeadSha,
      ),
      /requires an exact terminated-claimant takeover/,
    );
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
  });

  it("takes over only after proving the prior claimant terminated", async () => {
    const api = new FakeGitHubApi();
    const initialized = await bootstrap(api);
    const store = createStore(api);
    const journal = makeJournal();
    const appended = await store.append(journal, initialized.branchHeadSha);
    const firstClaim = makeClaim(journal);
    setWorkflowRun(api, firstClaim);
    const first = await store.claim(firstClaim, appended.branchHeadSha);
    const takeover = makeClaim(journal, {
      claimantRunId: 201,
      claimantWorkflowId: 301,
      takeover: {
        claimantRunId: 200,
        claimantRunAttempt: 1,
        conclusion: "failure",
      },
    });
    setWorkflowRun(api, takeover);
    await assert.rejects(
      store.claim(takeover, first.branchHeadSha),
      /has not terminated/,
    );

    setWorkflowRun(api, firstClaim, "completed", "failure");
    const second = await store.claim(takeover, first.branchHeadSha);
    assert.equal(second.reconciliation.claimantRunId, 201);
    assert.equal(
      api.requests.some(
        ({ method, path }) =>
          method === "GET" && path.endsWith("/actions/runs/200/attempts/1"),
      ),
      true,
    );
    const requestCount = api.requests.length;
    const repeated = await store.claim(
      { ...takeover, takeover: null },
      second.branchHeadSha,
    );
    assert.equal(repeated.branchHeadSha, second.branchHeadSha);
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
  });

  it("allows takeover after a claimant startup failure", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const journal = makeJournal();
    const appended = await store.append(journal, api.branchHead);
    const firstClaim = makeClaim(journal);
    setWorkflowRun(api, firstClaim);
    const claimed = await store.claim(firstClaim, appended.branchHeadSha);
    setWorkflowRun(api, firstClaim, "completed", "startup_failure");

    const takeover = makeClaim(journal, {
      claimantRunId: firstClaim.claimantRunId + 1,
      claimantWorkflowId: firstClaim.claimantWorkflowId + 1,
      takeover: {
        claimantRunId: firstClaim.claimantRunId,
        claimantRunAttempt: firstClaim.claimantRunAttempt,
        conclusion: "startup_failure",
      },
    });
    setWorkflowRun(api, takeover);

    await assert.doesNotReject(store.claim(takeover, claimed.branchHeadSha));
  });

  it("validates every claimant identity field against fresh GitHub metadata", async () => {
    const cases = [
      [
        "repository metadata",
        (api) => {
          api.repositoryOverrides.full_name = "other/widgets";
        },
        /repository metadata does not match/,
      ],
      [
        "workflow ID",
        (api, claim) => {
          api.claimantWorkflowOverrides.set(claim.claimantWorkflowId, {
            id: claim.claimantWorkflowId + 1,
          });
        },
        /not a canonical active workflow/,
      ],
      [
        "workflow path",
        (api, claim) => {
          api.claimantWorkflowOverrides.set(claim.claimantWorkflowId, {
            path: ".github/workflows/other.yml",
          });
        },
        /not a canonical active workflow/,
      ],
      [
        "workflow state",
        (api, claim) => {
          api.claimantWorkflowOverrides.set(claim.claimantWorkflowId, {
            state: "disabled_manually",
          });
        },
        /not a canonical active workflow/,
      ],
      [
        "run ID",
        (api, claim) => {
          api.workflowRuns.get("200/1").id = claim.claimantRunId + 1;
        },
        /provenance does not match/,
      ],
      [
        "run attempt",
        (api, claim) => {
          api.workflowRuns.get("200/1").run_attempt =
            claim.claimantRunAttempt + 1;
        },
        /provenance does not match/,
      ],
      [
        "run workflow",
        (api, claim) => {
          api.workflowRuns.get("200/1").workflow_id =
            claim.claimantWorkflowId + 1;
        },
        /provenance does not match/,
      ],
      [
        "run SHA",
        (api) => {
          api.workflowRuns.get("200/1").head_sha = EXTERNAL_SHA;
        },
        /provenance does not match/,
      ],
      [
        "head repository",
        (api) => {
          api.workflowRuns.get("200/1").head_repository.full_name =
            "other/widgets";
        },
        /provenance does not match/,
      ],
      [
        "run repository",
        (api) => {
          api.workflowRuns.get("200/1").repository.full_name = "other/widgets";
        },
        /provenance does not match/,
      ],
      [
        "event",
        (api) => {
          api.workflowRuns.get("200/1").event = "workflow_dispatch";
        },
        /provenance does not match/,
      ],
      [
        "head branch",
        (api) => {
          api.workflowRuns.get("200/1").head_branch = "feature";
        },
        /provenance does not match/,
      ],
      [
        "active status",
        (api) => {
          const run = api.workflowRuns.get("200/1");
          run.status = "completed";
          run.conclusion = "success";
        },
        /workflow is not active/,
      ],
      [
        "active conclusion",
        (api) => {
          api.workflowRuns.get("200/1").conclusion = "failure";
        },
        /workflow is not active/,
      ],
      [
        "default head",
        (api) => {
          api.defaultBranchHead = EXTERNAL_SHA;
        },
        /not at the current default-branch head/,
      ],
      [
        "default branch ref",
        (api) => {
          api.defaultBranchRef = "other";
        },
        /reference response has an invalid ref/,
      ],
    ];

    for (const [name, mutate, pattern] of cases) {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      const store = createStore(api);
      const journal = makeJournal();
      const appended = await store.append(journal, api.branchHead);
      const claim = makeClaim(journal);
      setWorkflowRun(api, claim);
      mutate(api, claim);
      const requestCount = api.requests.length;
      await assert.rejects(
        store.claim(claim, appended.branchHeadSha),
        pattern,
        name,
      );
      assert.equal(
        api.requests
          .slice(requestCount)
          .some(({ method }) => method === "POST" || method === "PATCH"),
        false,
        name,
      );
    }

    const deployApi = new FakeGitHubApi();
    await bootstrap(deployApi);
    const deployStore = createStore(deployApi);
    const deployJournal = makeJournal();
    const deployAppend = await deployStore.append(
      deployJournal,
      deployApi.branchHead,
    );
    const deployClaim = makeClaim(deployJournal);
    setWorkflowRun(deployApi, deployClaim);
    deployApi.claimantWorkflowOverrides.set(deployClaim.claimantWorkflowId, {
      path: ".github/workflows/deploy.yml",
    });
    await assert.doesNotReject(
      deployStore.claim(deployClaim, deployAppend.branchHeadSha),
    );
  });

  it("authorizes only the exact fresh active claim and refuses completion after the default head advances", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const journal = makeJournal();
    const appended = await store.append(journal, api.branchHead);
    const claim = makeClaim(journal);
    setWorkflowRun(api, claim);
    const claimed = await store.claim(claim, appended.branchHeadSha);

    const authorizationRequestCount = api.requests.length;
    assert.deepEqual(await store.authorize(claim, claimed.branchHeadSha), {
      branchHeadSha: claimed.branchHeadSha,
      reconciliation: claimed.reconciliation,
    });
    assert.equal(
      api.requests
        .slice(authorizationRequestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
    const directory = mkdtempSync(join(tmpdir(), "cloudflare-authorize-cli-"));
    try {
      const claimPath = join(directory, "claim.json");
      writeFileSync(claimPath, `${JSON.stringify(claim)}\n`);
      const stdout = [];
      await runCli(["authorize", claimPath, claimed.branchHeadSha], {
        env: cliEnv(),
        fetchImpl: api.fetch.bind(api),
        stdout: { write: (value) => stdout.push(value) },
      });
      assert.deepEqual(JSON.parse(stdout.join("")), {
        state: "authorized",
        branchHeadSha: claimed.branchHeadSha,
        reconciliation: {
          status: "claimed",
          targetRunId: claim.targetRunId,
          targetRunAttempt: claim.targetRunAttempt,
          claimantRunId: claim.claimantRunId,
          claimantRunAttempt: claim.claimantRunAttempt,
          claimantWorkflowId: claim.claimantWorkflowId,
          claimantHeadSha: claim.claimantHeadSha,
          action: claim.action,
          takeover: null,
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    await assert.rejects(
      store.authorize(
        { ...claim, action: "verify-promoted" },
        claimed.branchHeadSha,
      ),
      /requires a restore claim/,
    );
    await assert.rejects(
      store.authorize(
        { ...claim, claimantWorkflowId: claim.claimantWorkflowId + 1 },
        claimed.branchHeadSha,
      ),
      /does not match the exact active claim/,
    );

    api.defaultBranchHead = EXTERNAL_SHA;
    const requestCount = api.requests.length;
    await assert.rejects(
      store.authorize(claim, claimed.branchHeadSha),
      /not at the current default-branch head/,
    );
    await assert.rejects(
      store.complete(
        {
          schemaVersion: 1,
          claimantRunId: claim.claimantRunId,
          claimantRunAttempt: claim.claimantRunAttempt,
          result: { state: "unchanged", decision: "unchanged" },
        },
        claimed.branchHeadSha,
      ),
      /not at the current default-branch head/,
    );
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
  });

  it("reads an exact old journal after latest advances", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const oldJournal = makeJournal(12345, 1);
    const newJournal = makeJournal(12346, 3);

    const old = await store.append(oldJournal, api.branchHead);
    const latest = await store.append(newJournal, old.branchHeadSha);

    assert.deepEqual(await store.read(12345, 1), {
      branchHeadSha: latest.branchHeadSha,
      journal: oldJournal,
    });
    assert.deepEqual((await store.getState()).journal, newJournal);
  });

  it("rejects a journal that does not advance the durable run identity", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const latestJournal = makeJournal(12346, 3);
    const latest = await store.append(latestJournal, api.branchHead);

    await assert.rejects(
      store.append(makeJournal(12345, 9), latest.branchHeadSha),
      /must advance the latest durable run ID/,
    );
    await assert.rejects(
      store.append(makeJournal(12346, 4), latest.branchHeadSha),
      /run ID 12346 is already journaled/,
    );
    assert.deepEqual((await store.getState()).journal, latestJournal);
  });

  it("fails closed on missing journals and malformed storage combinations", async () => {
    const absentApi = new FakeGitHubApi();
    await assert.rejects(
      createStore(absentApi).read(999, 1),
      /journal store is absent; bootstrap is required/,
    );

    const missingApi = new FakeGitHubApi();
    await bootstrap(missingApi);
    await assert.rejects(
      createStore(missingApi).read(999, 1),
      /deployment journal 999\/1 does not exist/,
    );

    const missingLatestApi = new FakeGitHubApi();
    await bootstrap(missingLatestApi);
    await createStore(missingLatestApi).append(
      makeJournal(),
      missingLatestApi.branchHead,
    );
    const missingLatestTransition = missingLatestApi.mutateBranchFiles(
      (files) => {
        files.delete(".github/cloudflare-deployment-journals/latest.json");
      },
    );
    addMalformedTransitionAnchor(missingLatestApi, missingLatestTransition);
    await assert.rejects(
      createStore(missingLatestApi).getState(),
      /immutable journals exist without latest\.json/,
    );

    const missingImmutableApi = new FakeGitHubApi();
    await bootstrap(missingImmutableApi);
    await createStore(missingImmutableApi).append(
      makeJournal(),
      missingImmutableApi.branchHead,
    );
    const missingImmutableTransition = missingImmutableApi.mutateBranchFiles(
      (files) => {
        files.delete(".github/cloudflare-deployment-journals/12345-2.json");
      },
    );
    addMalformedTransitionAnchor(
      missingImmutableApi,
      missingImmutableTransition,
    );
    await assert.rejects(
      createStore(missingImmutableApi).getState(),
      /latest journal has no immutable copy/,
    );

    const missingBootstrapApi = new FakeGitHubApi();
    await bootstrap(missingBootstrapApi);
    await createStore(missingBootstrapApi).append(
      makeJournal(),
      missingBootstrapApi.branchHead,
    );
    const missingBootstrapTransition = missingBootstrapApi.mutateBranchFiles(
      (files) => {
        files.delete(".github/cloudflare-deployment-journals/bootstrap.json");
      },
    );
    addMalformedTransitionAnchor(
      missingBootstrapApi,
      missingBootstrapTransition,
    );
    await assert.rejects(
      createStore(missingBootstrapApi).getState(),
      /bootstrap marker is missing/,
    );
  });

  it("validates the current tip and direct transition and rejects malformed transition classes", async () => {
    const createLatest = async (journal = makeJournal()) => {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      const store = createStore(api);
      await store.append(journal, api.branchHead);
      return { api, store, journal };
    };
    const addJournalCommit = (api, journal, mutate = () => {}) => {
      const blobSha = api.createBlob(`${JSON.stringify(journal)}\n`);
      const immutablePath = `.github/cloudflare-deployment-journals/${journal.runId}-${journal.runAttempt}.json`;
      const transition = api.mutateBranchFiles((files) => {
        files.set(immutablePath, { sha: blobSha, mode: "100644" });
        files.set(".github/cloudflare-deployment-journals/latest.json", {
          sha: blobSha,
          mode: "100644",
        });
        mutate(files);
      });
      addAuthenticatedAnchor(api, {
        ...transition,
        transition: "append",
        recordPath: immutablePath,
        recordBlobSha: blobSha,
      });
    };

    {
      const { api } = await createLatest();
      api.commits.get(api.branchHead).parents = [api.branchHead];
      await assert.rejects(
        createStore(api).getState(),
        /not an exact single-parent transition/,
      );
    }

    for (const parents of [[], [TRUSTED_SHA, EXTERNAL_SHA]]) {
      const { api } = await createLatest();
      api.commits.get(api.branchHead).parents = parents;
      await assert.rejects(
        createStore(api).getState(),
        /not an exact single-parent transition/,
      );
    }

    {
      const { api, store } = await createLatest();
      const transition = api.mutateBranchFiles(() => {});
      addMalformedTransitionAnchor(api, transition);
      await assert.rejects(
        store.getState(),
        /empty, unrelated, or compound commit/,
      );
    }

    {
      const { api, store } = await createLatest();
      addJournalCommit(api, makeJournal(12346, 1), (files) => {
        files.set(".github/workflows/deploy.yml", {
          sha: api.createBlob("name: changed\n"),
          mode: "100644",
        });
      });
      await assert.rejects(store.getState(), /.github sibling path changed/);
    }

    {
      const { api, store } = await createLatest();
      addJournalCommit(api, makeJournal(12346, 1), (files) => {
        files.set("README.md", {
          sha: api.createBlob("changed\n"),
          mode: "100644",
        });
      });
      await assert.rejects(
        store.getState(),
        /path outside the journal directory changed/,
      );
    }

    {
      const { api, store, journal } = await createLatest();
      addJournalCommit(api, makeJournal(12346, 1), (files) => {
        const mutatedJournalSha = api.createBlob(
          `${JSON.stringify({ ...journal, artifactDigest: "a".repeat(64) })}\n`,
        );
        files.set(".github/cloudflare-deployment-journals/12345-2.json", {
          sha: mutatedJournalSha,
          mode: "100644",
        });
      });
      await assert.rejects(
        store.getState(),
        /immutable deployment journal .* was mutated or removed/,
      );
    }

    {
      const { api, store } = await createLatest();
      const deletion = api.mutateBranchFiles((files) => {
        files.delete(".github/cloudflare-deployment-journals/12345-2.json");
        files.delete(".github/cloudflare-deployment-journals/latest.json");
      });
      addMalformedTransitionAnchor(api, deletion);
      addJournalCommit(api, makeJournal(12346, 1), (files) => {
        const recreatedSha = api.createBlob(
          `${JSON.stringify(makeJournal())}\n`,
        );
        files.set(".github/cloudflare-deployment-journals/12345-2.json", {
          sha: recreatedSha,
          mode: "100644",
        });
      });
      await assert.rejects(
        store.getState(),
        /mutated or removed|immutable journals exist without latest\.json/,
      );
    }

    {
      const { api, store } = await createLatest();
      const journal = makeJournal(12346, 1);
      const blobSha = api.createBlob(`${JSON.stringify(journal)}\n`);
      const transition = api.mutateBranchFiles((files) => {
        files.set(".github/cloudflare-deployment-journals/12346-1.json", {
          sha: blobSha,
          mode: "100644",
        });
      });
      addMalformedTransitionAnchor(api, transition, {
        recordPath: ".github/cloudflare-deployment-journals/12346-1.json",
        recordBlobSha: blobSha,
      });
      await assert.rejects(store.getState(), /latest journal pointer is stale/);
    }

    {
      const { api, store, journal } = await createLatest();
      const verificationClaim = makeClaim(journal, {
        action: "verify-promoted",
      });
      setWorkflowRun(api, verificationClaim);
      await store.claim(verificationClaim, api.branchHead);
      const state = await store.getState();
      const priorSha = api.rootFiles
        .get(api.commits.get(api.branchHead).treeSha)
        .get(".github/cloudflare-deployment-journals/reconciliation.json").sha;
      const restoreRecord = {
        ...state.reconciliation,
        action: "restore",
        previousReconciliationSha: priorSha,
      };
      const restoreSha = api.createBlob(`${JSON.stringify(restoreRecord)}\n`);
      const transition = api.mutateBranchFiles((files) => {
        files.set(
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-claim.json",
          { sha: restoreSha, mode: "100644" },
        );
      });
      addMalformedTransitionAnchor(api, transition, {
        transition: "claim",
        recordPath:
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-claim.json",
        recordBlobSha: restoreSha,
      });
      await assert.rejects(store.getState(), /reconciliation pointer is stale/);
    }

    {
      const { api, store, journal } = await createLatest();
      const claim = makeClaim(journal);
      setWorkflowRun(api, claim);
      await store.claim(claim, api.branchHead);
      const files = api.rootFiles.get(api.commits.get(api.branchHead).treeSha);
      const claimSha = files.get(
        ".github/cloudflare-deployment-journals/reconciliation.json",
      ).sha;
      const transition = api.mutateBranchFiles((nextFiles) => {
        nextFiles.set(
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-201-1-restore-claim.json",
          { sha: claimSha, mode: "100644" },
        );
      });
      addMalformedTransitionAnchor(api, transition, {
        transition: "claim",
        recordPath:
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-201-1-restore-claim.json",
        recordBlobSha: claimSha,
      });
      await assert.rejects(
        store.getState(),
        /reconciliation pointer does not identify the added immutable record/,
      );
    }

    {
      const { api, store } = await createLatest();
      const mismatched = makeJournal(12347, 1);
      const blobSha = api.createBlob(`${JSON.stringify(mismatched)}\n`);
      const transition = api.mutateBranchFiles((files) => {
        files.set(".github/cloudflare-deployment-journals/12346-1.json", {
          sha: blobSha,
          mode: "100644",
        });
        files.set(".github/cloudflare-deployment-journals/latest.json", {
          sha: blobSha,
          mode: "100644",
        });
      });
      addMalformedTransitionAnchor(api, transition, {
        recordPath: ".github/cloudflare-deployment-journals/12346-1.json",
        recordBlobSha: blobSha,
      });
      await assert.rejects(
        store.getState(),
        /latest journal has no immutable copy/,
      );
    }

    {
      const { api, store } = await createLatest();
      const journal = makeJournal(12346, 1);
      const blobSha = api.createBlob(JSON.stringify(journal));
      const transition = api.mutateBranchFiles((files) => {
        files.set(".github/cloudflare-deployment-journals/12346-1.json", {
          sha: blobSha,
          mode: "100644",
        });
        files.set(".github/cloudflare-deployment-journals/latest.json", {
          sha: blobSha,
          mode: "100644",
        });
      });
      addMalformedTransitionAnchor(api, transition, {
        recordPath: ".github/cloudflare-deployment-journals/12346-1.json",
        recordBlobSha: blobSha,
      });
      await assert.rejects(store.getState(), /is not canonical JSON/);
    }

    {
      const { api, store, journal } = await createLatest();
      const verificationClaim = makeClaim(journal, {
        action: "verify-promoted",
      });
      setWorkflowRun(api, verificationClaim);
      await store.claim(verificationClaim, api.branchHead);
      const state = await store.getState();
      const restoreRecord = {
        ...state.reconciliation,
        action: "restore",
        previousReconciliationSha: null,
      };
      const restoreSha = api.createBlob(`${JSON.stringify(restoreRecord)}\n`);
      const transition = api.mutateBranchFiles((files) => {
        files.set(
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-claim.json",
          { sha: restoreSha, mode: "100644" },
        );
        files.set(
          ".github/cloudflare-deployment-journals/reconciliation.json",
          { sha: restoreSha, mode: "100644" },
        );
      });
      addMalformedTransitionAnchor(api, transition, {
        transition: "claim",
        recordPath:
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-claim.json",
        recordBlobSha: restoreSha,
      });
      await assert.rejects(
        store.getState(),
        /claim does not chain to the previous record/,
      );
    }

    {
      const { api, store, journal } = await createLatest();
      const claim = makeClaim(journal);
      setWorkflowRun(api, claim);
      await store.claim(claim, api.branchHead);
      const state = await store.getState();
      const claimSha = api.rootFiles
        .get(api.commits.get(api.branchHead).treeSha)
        .get(".github/cloudflare-deployment-journals/reconciliation.json").sha;
      const completion = {
        ...state.reconciliation,
        status: "completed",
        previousReconciliationSha: claimSha,
        claimSha: EXTERNAL_SHA,
        result: { state: "unchanged", decision: "unchanged" },
      };
      const completionSha = api.createBlob(`${JSON.stringify(completion)}\n`);
      const transition = api.mutateBranchFiles((files) => {
        files.set(
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-completion.json",
          { sha: completionSha, mode: "100644" },
        );
        files.set(
          ".github/cloudflare-deployment-journals/reconciliation.json",
          { sha: completionSha, mode: "100644" },
        );
      });
      addMalformedTransitionAnchor(api, transition, {
        transition: "complete",
        recordPath:
          ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-restore-completion.json",
        recordBlobSha: completionSha,
      });
      await assert.rejects(
        store.getState(),
        /completion does not link to its exact claim/,
      );
    }
  });

  it("enforces the absolute history ceiling before reading record bodies", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    addAuthenticatedAnchor(api, {
      previousHeadSha: api.branchHead,
      nextHeadSha: EXTERNAL_SHA,
      transition: "claim",
      recordPath:
        ".github/cloudflare-deployment-journals/reconciliations/1-1-1-1-restore-claim.json",
      recordBlobSha: api.blobs.keys().next().value,
      sequence: 1_025,
    });
    await assert.rejects(
      createStore(api).getState(),
      /sequence exceeds the 1024-commit limit/,
    );
  });

  it("replays every authenticated transition instead of trusting a tip comparison", async () => {
    const makeHistory = async (completedCycles) => {
      const api = new FakeGitHubApi();
      await bootstrap(api);
      const journal = makeJournal();
      await createStore(api).append(journal, api.branchHead);
      appendCompletedRestoreCycles(api, journal, completedCycles);
      api.requests.length = 0;
      await createStore(api).getState();
      return api.requests;
    };

    const shortRequests = await makeHistory(1);
    const longRequests = await makeHistory(300);
    assert.equal(
      shortRequests.filter(({ path }) => path.includes("/git/commits/")).length,
      5,
    );
    assert.equal(
      longRequests.filter(({ path }) => path.includes("/git/commits/")).length,
      603,
    );
    assert.equal(
      shortRequests.filter(({ path }) => path.includes("/statuses")).length,
      1,
    );
    assert.equal(
      longRequests.filter(({ path }) => path.includes("/statuses")).length,
      13,
    );
    assert.equal(
      [...shortRequests, ...longRequests].some(({ path }) =>
        path.includes("/compare/"),
      ),
      false,
    );
  });

  it("rejects a coherent rewrite without the immutable external ruleset checkpoint", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    await createStore(api).append(makeJournal(), api.branchHead);

    const originalHead = api.commits.get(api.branchHead);
    const originalBootstrapSha = originalHead.parents[0];
    const originalBootstrap = api.commits.get(originalBootstrapSha);
    const rewrittenBootstrapSha = api.createCommit(originalBootstrap.treeSha, [
      TRUSTED_SHA,
    ]);
    const rewrittenHeadSha = api.createCommit(originalHead.treeSha, [
      rewrittenBootstrapSha,
    ]);
    api.branchHead = rewrittenHeadSha;
    api.rulesets[1].rules = api.rulesets[1].rules.filter(
      ({ type }) => type !== "non_fast_forward",
    );
    api.requests.length = 0;

    await assert.rejects(
      createStore(api).getState(),
      /rulesets do not match the exact writer and immutable rule pair/,
    );
    assert.deepEqual(
      api.requests.map(({ method, path }) => ({ method, path })),
      [
        { method: "GET", path: "/repos/acme/widgets/rulesets" },
        { method: "GET", path: "/repos/acme/widgets/rulesets/1" },
        { method: "GET", path: "/repos/acme/widgets/rulesets/2" },
      ],
    );
  });

  it("reserves seven append commits through completed verification without a marker, restoration, and follow-up recovery", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const journal = makeJournal();
    const store = createStore(api, TOKEN, 8);
    await store.append(journal, api.branchHead);

    const verificationClaim = makeClaim(journal, {
      claimantRunId: 9_000,
      action: "verify-promoted",
    });
    setWorkflowRun(api, verificationClaim);
    await store.claim(verificationClaim, api.branchHead);
    await store.complete(
      {
        schemaVersion: 1,
        claimantRunId: verificationClaim.claimantRunId,
        claimantRunAttempt: verificationClaim.claimantRunAttempt,
        result: { state: "promoted", decision: "restore" },
      },
      api.branchHead,
    );

    const restoreClaim = { ...verificationClaim, action: "restore" };
    await store.claim(restoreClaim, api.branchHead);
    await store.complete(
      {
        schemaVersion: 1,
        claimantRunId: restoreClaim.claimantRunId,
        claimantRunAttempt: restoreClaim.claimantRunAttempt,
        result: { state: "restored", decision: "restored" },
      },
      api.branchHead,
    );

    const followUpClaim = makeClaim(journal, { claimantRunId: 9_001 });
    setWorkflowRun(api, followUpClaim);
    await store.claim(followUpClaim, api.branchHead);
    await store.complete(
      {
        schemaVersion: 1,
        claimantRunId: followUpClaim.claimantRunId,
        claimantRunAttempt: followUpClaim.claimantRunAttempt,
        result: { state: "unchanged", decision: "unchanged" },
      },
      api.branchHead,
    );

    const state = await store.getState();
    assert.equal(state.state, "latest");
    assert.deepEqual(state.reconciliation.result, {
      state: "unchanged",
      decision: "unchanged",
    });

    const requestCount = api.requests.length;
    await assert.rejects(
      store.append(makeJournal(12347, 1), api.branchHead),
      /journal history lacks capacity/,
    );
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );

    const insufficientApi = new FakeGitHubApi();
    await bootstrap(insufficientApi);
    const insufficientStore = createStore(insufficientApi, TOKEN, 7);
    const insufficientRequestCount = insufficientApi.requests.length;
    await assert.rejects(
      insufficientStore.append(makeJournal(), insufficientApi.branchHead),
      /journal history lacks capacity/,
    );
    assert.equal(
      insufficientApi.requests
        .slice(insufficientRequestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
  });

  it("refuses a completion that would cross the history ceiling", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api, TOKEN, 12);
    const journal = makeJournal();
    await store.append(journal, api.branchHead);
    const previousReconciliationSha = appendCompletedRestoreCycles(
      api,
      journal,
      4,
    );
    const claim = makeClaim(journal, {
      claimantRunId: 9_100,
      action: "verify-promoted",
    });
    const verificationSha = appendReconciliationRecord(api, {
      ...claim,
      status: "claimed",
      previousReconciliationSha,
    });
    const restoreClaim = { ...claim, action: "restore" };
    appendReconciliationRecord(api, {
      ...restoreClaim,
      status: "claimed",
      previousReconciliationSha: verificationSha,
    });
    setWorkflowRun(api, restoreClaim);

    const requestCount = api.requests.length;
    await assert.rejects(
      store.complete(
        {
          schemaVersion: 1,
          claimantRunId: restoreClaim.claimantRunId,
          claimantRunAttempt: restoreClaim.claimantRunAttempt,
          result: { state: "restored", decision: "restored" },
        },
        api.branchHead,
      ),
      /journal history lacks capacity/,
    );
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
    assert.equal((await store.getState()).reconciliation.status, "claimed");
  });

  it("blocks all object writes when ancestry validation fails", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    await store.append(makeJournal(), api.branchHead);
    const transition = api.mutateBranchFiles(() => {});
    addMalformedTransitionAnchor(api, transition);
    const requestCount = api.requests.length;

    await assert.rejects(
      store.append(makeJournal(12346, 1), api.branchHead),
      /empty, unrelated, or compound commit/,
    );
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
  });

  it("fails a concurrent non-fast-forward ref update without retrying", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const firstJournal = makeJournal(12345, 1);
    const first = await store.append(firstJournal, api.branchHead);
    api.moveRefBeforeNextPatch = true;

    const patchCount = api.patchCount;
    await assert.rejects(
      store.append(makeJournal(12346, 1), first.branchHeadSha),
      /update journal branch failed with HTTP 422/,
    );
    assert.equal(api.patchCount, patchCount + 1);
    assert.equal(api.branchHead, EXTERNAL_SHA);
    await assert.rejects(
      store.getState(),
      /conflicts with the authenticated prepared transition/,
    );
  });

  it("rejects a stale reconciled branch head before creating objects", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const reconciledHead = api.branchHead;
    await store.append(makeJournal(12345, 1), reconciledHead);
    const requestCount = api.requests.length;

    await assert.rejects(
      store.append(makeJournal(12346, 1), reconciledHead),
      /journal branch changed after reconciliation; refusing append/,
    );
    assert.equal(
      api.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );
  });

  it("rejects malformed, oversized, and wrong-origin API responses", async () => {
    const referenceUrl = `${API_ORIGIN}/repos/acme/widgets/git/ref/heads/cloudflare-deployment-journal`;
    const makeStore = (responseFactory) => {
      const api = new FakeGitHubApi();
      return createCloudflareJournalStore({
        expectedAppId: JOURNAL_APP_ID,
        hmacKey: HMAC_KEY,
        repository: REPOSITORY,
        token: TOKEN,
        trustedSha: TRUSTED_SHA,
        fetchImpl: async (input, init) => {
          const url = input instanceof URL ? input : new URL(input);
          if (url.href === referenceUrl) {
            return responseFactory();
          }
          return api.fetch(input, init);
        },
      });
    };
    const malformedStore = makeStore(() => jsonResponse(referenceUrl, 200, {}));
    await assert.rejects(
      malformedStore.getState(),
      /GitHub reference response has an invalid ref/,
    );

    const malformedJsonStore = makeStore(() =>
      textResponse(referenceUrl, 200, "{"),
    );
    await assert.rejects(
      malformedJsonStore.getState(),
      /returned malformed JSON/,
    );

    const oversizedStore = makeStore(() =>
      textResponse(referenceUrl, 200, "x".repeat(256 * 1024 + 1)),
    );
    await assert.rejects(
      oversizedStore.getState(),
      /response exceeds the size limit/,
    );

    const wrongOriginStore = makeStore(() =>
      jsonResponse(
        "https://example.invalid/repos/acme/widgets/git/ref/heads/cloudflare-deployment-journal",
        404,
        {},
      ),
    );
    await assert.rejects(
      wrongOriginStore.getState(),
      /response from an unexpected origin/,
    );
  });

  it("never includes token values in transport or HTTP errors", async () => {
    const throwingStore = createCloudflareJournalStore({
      expectedAppId: JOURNAL_APP_ID,
      hmacKey: HMAC_KEY,
      repository: REPOSITORY,
      token: TOKEN,
      trustedSha: TRUSTED_SHA,
      fetchImpl: withValidRulesets(async () => {
        throw new Error(`transport exposed ${TOKEN}`);
      }),
    });
    await assert.rejects(throwingStore.getState(), (error) => {
      assert.equal(
        error.message,
        "GitHub API list journal anchor statuses request failed",
      );
      assert.equal(error.message.includes(TOKEN), false);
      assert.equal(error.message.includes(HMAC_KEY), false);
      return true;
    });

    const statusUrl = `${API_ORIGIN}/repos/acme/widgets/commits/${TRUSTED_SHA}/statuses?per_page=100&page=1`;
    const errorResponse = jsonResponse(statusUrl, 500, {
      message: `server reflected ${TOKEN} ${HMAC_KEY}`,
    });
    const httpStore = createCloudflareJournalStore({
      expectedAppId: JOURNAL_APP_ID,
      hmacKey: HMAC_KEY,
      repository: REPOSITORY,
      token: TOKEN,
      trustedSha: TRUSTED_SHA,
      fetchImpl: withValidRulesets(async () => errorResponse),
    });
    await assert.rejects(httpStore.getState(), (error) => {
      assert.equal(
        error.message,
        "GitHub API list journal anchor statuses failed with HTTP 500",
      );
      assert.equal(error.message.includes(TOKEN), false);
      assert.equal(error.message.includes(HMAC_KEY), false);
      return true;
    });
    assert.equal(errorResponse.bodyUsed, true);
  });

  it("validates repository names and identifiers", async () => {
    for (const hmacKey of [undefined, "", "A".repeat(64), "0".repeat(63)]) {
      assert.throws(
        () =>
          createCloudflareJournalStore({
            expectedAppId: JOURNAL_APP_ID,
            fetchImpl: async () => {
              throw new Error("unreachable");
            },
            hmacKey,
            repository: REPOSITORY,
            token: TOKEN,
            trustedSha: TRUSTED_SHA,
          }),
        /CLOUDFLARE_JOURNAL_HMAC_KEY must be exactly 64 lowercase hexadecimal characters/,
      );
    }
    for (const trustedSha of [undefined, "", "A".repeat(40), "0".repeat(39)]) {
      assert.throws(
        () =>
          createCloudflareJournalStore({
            expectedAppId: JOURNAL_APP_ID,
            fetchImpl: async () => {
              throw new Error("unreachable");
            },
            hmacKey: HMAC_KEY,
            repository: REPOSITORY,
            token: TOKEN,
            trustedSha,
          }),
        /CLOUDFLARE_JOURNAL_TRUSTED_SHA must be a lowercase 40-character Git SHA/,
      );
    }
    assert.throws(
      () =>
        createCloudflareJournalStore({
          expectedAppId: JOURNAL_APP_ID,
          fetchImpl: async () => {
            throw new Error("unreachable");
          },
          repository: "acme/widgets/extra",
          token: TOKEN,
        }),
      /GITHUB_REPOSITORY must be owner\/repository/,
    );
    assert.throws(
      () =>
        createCloudflareJournalStore({
          expectedAppId: JOURNAL_APP_ID,
          fetchImpl: async () => {
            throw new Error("unreachable");
          },
          repository: REPOSITORY,
          token: "token with spaces",
        }),
      /GH_TOKEN must be a non-empty API token/,
    );
    assert.throws(
      () =>
        createCloudflareJournalStore({
          fetchImpl: async () => {
            throw new Error("unreachable");
          },
          repository: REPOSITORY,
          token: TOKEN,
        }),
      /expected GitHub App ID must be a positive safe integer/,
    );
    for (const appId of [undefined, "0900", "0", "1.5"]) {
      await assert.rejects(
        runCli([], {
          env: cliEnv({ CLOUDFLARE_JOURNAL_APP_ID: appId }),
          fetchImpl: async () => {
            throw new Error("unreachable");
          },
        }),
        /CLOUDFLARE_JOURNAL_APP_ID must be a canonical positive integer/,
      );
    }

    const mismatchedRootApi = new FakeGitHubApi();
    const mismatchedRootStore = createCloudflareJournalStore({
      expectedAppId: JOURNAL_APP_ID,
      fetchImpl: mismatchedRootApi.fetch.bind(mismatchedRootApi),
      hmacKey: HMAC_KEY,
      repository: REPOSITORY,
      token: TOKEN,
      trustedSha: EXTERNAL_SHA,
    });
    const requestCount = mismatchedRootApi.requests.length;
    await assert.rejects(
      mismatchedRootStore.bootstrap(100, 1),
      /does not match CLOUDFLARE_JOURNAL_TRUSTED_SHA/,
    );
    assert.equal(
      mismatchedRootApi.requests
        .slice(requestCount)
        .some(({ method }) => method === "POST" || method === "PATCH"),
      false,
    );

    const api = new FakeGitHubApi();
    const store = createStore(api);
    await assert.rejects(
      store.bootstrap(0, 1),
      /run ID must be a positive safe integer/,
    );
    await assert.rejects(
      store.bootstrap(1, 0),
      /run attempt must be a positive safe integer/,
    );
  });

  it("writes canonical state and exact-read CLI output files", async () => {
    const api = new FakeGitHubApi();
    await bootstrap(api);
    const store = createStore(api);
    const firstJournal = makeJournal(12345, 1);
    const latestJournal = makeJournal(12346, 1);
    const first = await store.append(firstJournal, api.branchHead);
    await store.append(latestJournal, first.branchHeadSha);

    const directory = mkdtempSync(join(tmpdir(), "cloudflare-journal-store-"));
    try {
      const stateOutput = join(directory, "latest.json");
      const stateStdout = [];
      await runCli(["state", stateOutput], {
        env: cliEnv(),
        fetchImpl: api.fetch.bind(api),
        stdout: { write: (value) => stateStdout.push(value) },
      });
      assert.equal(
        readFileSync(stateOutput, "utf8"),
        `${JSON.stringify(latestJournal)}\n`,
      );
      assert.deepEqual(JSON.parse(stateStdout.join("")), {
        state: "latest",
        branchHeadSha: api.branchHead,
        runId: latestJournal.runId,
        runAttempt: latestJournal.runAttempt,
        headSha: latestJournal.headSha,
      });

      const readOutput = join(directory, "old.json");
      const readStdout = [];
      await runCli(["read", "12345", "1", readOutput], {
        env: cliEnv(),
        fetchImpl: api.fetch.bind(api),
        stdout: { write: (value) => readStdout.push(value) },
      });
      assert.equal(
        readFileSync(readOutput, "utf8"),
        `${JSON.stringify(firstJournal)}\n`,
      );
      assert.equal(JSON.parse(readStdout.join("")).state, "found");

      const absentOutput = join(directory, "absent.json");
      const absentApi = new FakeGitHubApi();
      const absentStdout = [];
      await runCli(["state", absentOutput], {
        env: cliEnv(),
        fetchImpl: absentApi.fetch.bind(absentApi),
        stdout: { write: (value) => absentStdout.push(value) },
      });
      assert.equal(existsSync(absentOutput), false);
      assert.deepEqual(JSON.parse(absentStdout.join("")), { state: "absent" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
