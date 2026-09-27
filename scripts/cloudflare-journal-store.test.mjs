import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  api.workflowRuns.set(`${claim.claimantRunId}/${claim.claimantRunAttempt}`, {
    id: claim.claimantRunId,
    run_attempt: claim.claimantRunAttempt,
    workflow_id: claim.claimantWorkflowId,
    head_sha: claim.claimantHeadSha,
    head_repository: { full_name: REPOSITORY },
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

class FakeGitHubApi {
  constructor() {
    this.nextObjectId = 1;
    this.blobs = new Map();
    this.trees = new Map();
    this.rootFiles = new Map();
    this.commits = new Map();
    this.branchHead = null;
    this.requests = [];
    this.workflowRuns = new Map();
    this.patchCount = 0;
    this.moveRefBeforeNextPatch = false;

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
      const sha = this.nextSha();
      this.trees.set(sha, directFiles);
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
    const commit = this.commits.get(this.branchHead);
    assert.notEqual(commit, undefined);
    const files = new Map(this.rootFiles.get(commit.treeSha));
    mutator(files);
    const treeSha = this.createRootTree(files);
    this.branchHead = this.createCommit(treeSha, [this.branchHead]);
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

    if (
      method === "GET" &&
      path === "/git/ref/heads/cloudflare-deployment-journal"
    ) {
      return this.branchHead === null
        ? this.response(url.href, 404, { message: "Not Found" })
        : this.referenceResponse(url.href, this.branchHead);
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

    if (method === "POST" && path === "/git/refs") {
      if (this.branchHead !== null) {
        return this.response(url.href, 422, { message: "Reference exists" });
      }
      assert.equal(body.ref, BRANCH_REF);
      assert.equal(this.commits.has(body.sha), true);
      this.branchHead = body.sha;
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
      return this.referenceResponse(url.href, body.sha);
    }

    throw new Error(`Unexpected fake GitHub request: ${method} ${path}`);
  }
}

function createStore(api, token = TOKEN) {
  return createCloudflareJournalStore({
    fetchImpl: api.fetch.bind(api),
    repository: REPOSITORY,
    token,
  });
}

async function bootstrap(api, runId = 100, runAttempt = 1) {
  return createStore(api).bootstrap(TRUSTED_SHA, runId, runAttempt);
}

describe("Cloudflare deployment journal store", () => {
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
    const initialized = await store.bootstrap(TRUSTED_SHA, 100, 1);
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
      store.bootstrap(TRUSTED_SHA, 100, 1),
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
        ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-claim.json",
      ),
      true,
    );
    assert.equal(
      files.has(
        ".github/cloudflare-deployment-journals/reconciliations/12345-2-200-1-completion.json",
      ),
      true,
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
    missingLatestApi.mutateBranchFiles((files) => {
      files.delete(".github/cloudflare-deployment-journals/latest.json");
    });
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
    missingImmutableApi.mutateBranchFiles((files) => {
      files.delete(".github/cloudflare-deployment-journals/12345-2.json");
    });
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
    missingBootstrapApi.mutateBranchFiles((files) => {
      files.delete(".github/cloudflare-deployment-journals/bootstrap.json");
    });
    await assert.rejects(
      createStore(missingBootstrapApi).getState(),
      /bootstrap marker is missing/,
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
    assert.deepEqual((await store.getState()).journal, firstJournal);
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
    const malformedStore = createCloudflareJournalStore({
      repository: REPOSITORY,
      token: TOKEN,
      fetchImpl: async () => jsonResponse(referenceUrl, 200, {}),
    });
    await assert.rejects(
      malformedStore.getState(),
      /GitHub reference response has an invalid ref/,
    );

    const malformedJsonStore = createCloudflareJournalStore({
      repository: REPOSITORY,
      token: TOKEN,
      fetchImpl: async () => textResponse(referenceUrl, 200, "{"),
    });
    await assert.rejects(
      malformedJsonStore.getState(),
      /returned malformed JSON/,
    );

    const oversizedStore = createCloudflareJournalStore({
      repository: REPOSITORY,
      token: TOKEN,
      fetchImpl: async () =>
        textResponse(referenceUrl, 200, "x".repeat(256 * 1024 + 1)),
    });
    await assert.rejects(
      oversizedStore.getState(),
      /response exceeds the size limit/,
    );

    const wrongOriginStore = createCloudflareJournalStore({
      repository: REPOSITORY,
      token: TOKEN,
      fetchImpl: async () =>
        jsonResponse(
          "https://example.invalid/repos/acme/widgets/git/ref/heads/cloudflare-deployment-journal",
          404,
          {},
        ),
    });
    await assert.rejects(
      wrongOriginStore.getState(),
      /response from an unexpected origin/,
    );
  });

  it("never includes token values in transport or HTTP errors", async () => {
    const throwingStore = createCloudflareJournalStore({
      repository: REPOSITORY,
      token: TOKEN,
      fetchImpl: async () => {
        throw new Error(`transport exposed ${TOKEN}`);
      },
    });
    await assert.rejects(throwingStore.getState(), (error) => {
      assert.equal(
        error.message,
        "GitHub API read journal branch request failed",
      );
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });

    const referenceUrl = `${API_ORIGIN}/repos/acme/widgets/git/ref/heads/cloudflare-deployment-journal`;
    const errorResponse = jsonResponse(referenceUrl, 500, {
      message: `server reflected ${TOKEN}`,
    });
    const httpStore = createCloudflareJournalStore({
      repository: REPOSITORY,
      token: TOKEN,
      fetchImpl: async () => errorResponse,
    });
    await assert.rejects(httpStore.getState(), (error) => {
      assert.equal(
        error.message,
        "GitHub API read journal branch failed with HTTP 500",
      );
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(errorResponse.bodyUsed, true);
  });

  it("validates repository names, identifiers, and trusted SHAs", async () => {
    assert.throws(
      () =>
        createCloudflareJournalStore({
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
          fetchImpl: async () => {
            throw new Error("unreachable");
          },
          repository: REPOSITORY,
          token: "token with spaces",
        }),
      /GH_TOKEN must be a non-empty API token/,
    );

    const api = new FakeGitHubApi();
    const store = createStore(api);
    await assert.rejects(
      store.bootstrap("A".repeat(40), 1, 1),
      /trusted SHA must be a lowercase 40-character Git SHA/,
    );
    await assert.rejects(
      store.bootstrap(TRUSTED_SHA, 0, 1),
      /run ID must be a positive safe integer/,
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
        env: { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: REPOSITORY },
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
        env: { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: REPOSITORY },
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
        env: { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: REPOSITORY },
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
