import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertReconciledPredecessor,
  classifyDeploymentState,
  decideRestoration,
  evaluateDeployment,
  hydrateDeploymentModel,
  isOwnedCandidateAtZero,
  isOwnedPromoted,
  isRestoredPrevious,
  isUnchangedOriginal,
  parseDeploymentJournal,
  parseDeploymentList,
  parseDeploymentStatus,
  parseGitSha,
  parseSha256,
  parseUuid,
  parseWranglerJsonl,
} from "./cloudflare-deployment.mjs";

const PREVIOUS_VERSION = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_VERSION = "22222222-2222-4222-8222-222222222222";
const EXTERNAL_VERSION = "33333333-3333-4333-8333-333333333333";
const ORIGINAL_DEPLOYMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CANDIDATE_DEPLOYMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROMOTED_DEPLOYMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RESTORED_DEPLOYMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EXTERNAL_DEPLOYMENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WORKER_TAG = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TIMESTAMP = "2026-09-26T12:34:56.789Z";
const CANDIDATE_MESSAGE = "candidate 0123456789abcdef";
const PROMOTED_MESSAGE = "promote 0123456789abcdef";
const RESTORED_MESSAGE = "restore 0123456789abcdef";
const WORKER_NAME = "sentry-mcp";

const model = {
  originalDeploymentId: ORIGINAL_DEPLOYMENT,
  previousVersionId: PREVIOUS_VERSION,
  candidateVersionId: CANDIDATE_VERSION,
  candidate: {
    deploymentId: CANDIDATE_DEPLOYMENT,
    message: CANDIDATE_MESSAGE,
    predecessorDeploymentId: ORIGINAL_DEPLOYMENT,
  },
  promoted: {
    deploymentId: PROMOTED_DEPLOYMENT,
    message: PROMOTED_MESSAGE,
    predecessorDeploymentId: CANDIDATE_DEPLOYMENT,
  },
  restored: {
    deploymentId: RESTORED_DEPLOYMENT,
    message: RESTORED_MESSAGE,
    predecessorDeploymentId: PROMOTED_DEPLOYMENT,
  },
};

const journal = {
  schemaVersion: 1,
  runId: 12345,
  runAttempt: 2,
  headSha: "0123456789abcdef0123456789abcdef01234567",
  artifactDigest:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  uploadConfigDigest:
    "89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  workerName: WORKER_NAME,
  workerTag: WORKER_TAG,
  originalDeploymentId: ORIGINAL_DEPLOYMENT,
  previousVersionId: PREVIOUS_VERSION,
  candidateVersionId: CANDIDATE_VERSION,
  messages: {
    candidate: CANDIDATE_MESSAGE,
    promoted: PROMOTED_MESSAGE,
    restored: RESTORED_MESSAGE,
  },
};

function reconciliationCompletion(state, decision, action) {
  return {
    state: "completed",
    branchHeadSha: "f".repeat(40),
    reconciliation: {
      status: "completed",
      targetRunId: journal.runId,
      targetRunAttempt: journal.runAttempt,
      claimantRunId: 54321,
      claimantRunAttempt: 1,
      claimantWorkflowId: 700,
      claimantHeadSha: journal.headSha,
      action,
      takeover: null,
    },
    result: { state, decision },
  };
}

function rawDeployment(id, message, versions, strategy = "percentage") {
  return {
    id,
    source: "wrangler",
    strategy,
    author_email: "deploy@example.invalid",
    created_on: TIMESTAMP,
    annotations: message === null ? {} : { "workers/message": message },
    versions: versions.map(([version_id, percentage]) => ({
      version_id,
      percentage,
    })),
  };
}

const original = rawDeployment(ORIGINAL_DEPLOYMENT, null, [
  [PREVIOUS_VERSION, 100],
]);
const candidate = rawDeployment(CANDIDATE_DEPLOYMENT, CANDIDATE_MESSAGE, [
  [CANDIDATE_VERSION, 0],
  [PREVIOUS_VERSION, 100],
]);
const promoted = rawDeployment(PROMOTED_DEPLOYMENT, PROMOTED_MESSAGE, [
  [CANDIDATE_VERSION, 100],
]);
const restored = rawDeployment(RESTORED_DEPLOYMENT, RESTORED_MESSAGE, [
  [PREVIOUS_VERSION, 100],
]);
const external = rawDeployment(EXTERNAL_DEPLOYMENT, "manual replacement", [
  [EXTERNAL_VERSION, 100],
]);

function snapshot(current, history) {
  return {
    current: parseDeploymentStatus(JSON.stringify(current)),
    history: parseDeploymentList(JSON.stringify(history)),
  };
}

function session(commandLineArgs) {
  return {
    type: "wrangler-session",
    version: 1,
    wrangler_version: "4.80.0",
    command_line_args: commandLineArgs,
    log_file_path: "/tmp/wrangler.log",
    timestamp: TIMESTAMP,
  };
}

function jsonl(...records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

const uploadArgs = ["versions", "upload", "--message", CANDIDATE_MESSAGE];
const candidateArgs = [
  "versions",
  "deploy",
  `${PREVIOUS_VERSION}@100`,
  `${CANDIDATE_VERSION}@0`,
  "--message",
  CANDIDATE_MESSAGE,
  "--yes",
];

function uploadSuccess() {
  return {
    type: "version-upload",
    version: 1,
    worker_name: "sentry-mcp",
    worker_tag: WORKER_TAG,
    version_id: CANDIDATE_VERSION,
    preview_url: null,
    preview_alias_url: null,
    worker_name_overridden: false,
    timestamp: TIMESTAMP,
  };
}

function deploySuccess(deploymentId = CANDIDATE_DEPLOYMENT) {
  return {
    type: "version-deploy",
    version: 1,
    worker_name: "sentry-mcp",
    worker_tag: WORKER_TAG,
    deployment_id: deploymentId,
    version_traffic: {},
    timestamp: TIMESTAMP,
  };
}

describe("Cloudflare deployment parsing", () => {
  it("parses strict identifiers and digests", () => {
    const gitSha = "0123456789abcdef0123456789abcdef01234567";
    const sha256 =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    assert.equal(parseUuid(PREVIOUS_VERSION), PREVIOUS_VERSION);
    assert.equal(parseGitSha(gitSha), gitSha);
    assert.equal(parseSha256(sha256), sha256);
    assert.throws(
      () => parseUuid(ORIGINAL_DEPLOYMENT.toUpperCase()),
      /lowercase UUID/,
    );
    assert.throws(
      () => parseGitSha(gitSha.toUpperCase()),
      /lowercase 40-character/,
    );
    assert.throws(() => parseSha256(sha256.slice(1)), /SHA-256/);
  });

  it("parses successful upload and deploy JSONL", () => {
    assert.deepEqual(
      parseWranglerJsonl(jsonl(session(uploadArgs), uploadSuccess()), {
        type: "version-upload",
        commandLineArgs: uploadArgs,
        workerTag: WORKER_TAG,
      }),
      {
        type: "version-upload",
        workerName: "sentry-mcp",
        workerTag: WORKER_TAG,
        versionId: CANDIDATE_VERSION,
      },
    );
    assert.deepEqual(
      parseWranglerJsonl(jsonl(session(uploadArgs), uploadSuccess()), {
        type: "version-upload",
        commandLineArgs: uploadArgs,
        workerTag: null,
      }),
      {
        type: "version-upload",
        workerName: "sentry-mcp",
        workerTag: WORKER_TAG,
        versionId: CANDIDATE_VERSION,
      },
    );
    assert.deepEqual(
      parseWranglerJsonl(jsonl(session(candidateArgs), deploySuccess()), {
        type: "version-deploy",
        commandLineArgs: candidateArgs,
        workerTag: WORKER_TAG,
      }),
      {
        type: "version-deploy",
        workerName: "sentry-mcp",
        workerTag: WORKER_TAG,
        deploymentId: CANDIDATE_DEPLOYMENT,
      },
    );
  });

  it("rejects malformed, failed, extra, out-of-order, and unexpected output", () => {
    const expected = {
      type: "version-upload",
      commandLineArgs: uploadArgs,
      workerTag: WORKER_TAG,
    };
    const failed = {
      type: "command-failed",
      version: 1,
      message: "failed after commit",
      timestamp: TIMESTAMP,
    };
    const cases = [
      "not json\n",
      `${JSON.stringify(session(uploadArgs))}\n{not json}\n`,
      jsonl(uploadSuccess(), session(uploadArgs)),
      jsonl(session(uploadArgs), uploadSuccess(), uploadSuccess()),
      jsonl(session(uploadArgs), failed),
      jsonl(session([...uploadArgs, "--dry-run"]), uploadSuccess()),
      jsonl(session(uploadArgs), { ...uploadSuccess(), worker_name: "other" }),
      jsonl(session(uploadArgs), { ...uploadSuccess(), worker_tag: "changed" }),
      jsonl(session(uploadArgs), {
        ...uploadSuccess(),
        worker_name_overridden: true,
      }),
      jsonl(session(uploadArgs), { ...uploadSuccess(), unexpected: true }),
    ];

    for (const output of cases) {
      assert.throws(() => parseWranglerJsonl(output, expected));
    }
  });

  it("parses traffic as an unordered exact set and rejects malformed states", () => {
    const parsed = snapshot(candidate, [original, candidate]);
    assert.deepEqual(parsed.current.versions, [
      { versionId: PREVIOUS_VERSION, percentage: 100 },
      { versionId: CANDIDATE_VERSION, percentage: 0 },
    ]);

    const malformedStates = [
      rawDeployment(CANDIDATE_DEPLOYMENT, CANDIDATE_MESSAGE, [
        [PREVIOUS_VERSION, 90],
        [CANDIDATE_VERSION, 0],
      ]),
      rawDeployment(CANDIDATE_DEPLOYMENT, CANDIDATE_MESSAGE, [
        [PREVIOUS_VERSION, 50],
        [PREVIOUS_VERSION, 50],
      ]),
      { ...candidate, id: "not-a-uuid" },
      { ...candidate, versions: "not-an-array" },
    ];
    for (const malformed of malformedStates) {
      assert.throws(() => parseDeploymentStatus(JSON.stringify(malformed)));
    }
  });

  it("validates the durable recovery journal", () => {
    assert.deepEqual(parseDeploymentJournal(journal), journal);
    assert.throws(
      () => parseDeploymentJournal({ ...journal, unexpected: true }),
      /unexpected field/,
    );
    assert.throws(
      () =>
        parseDeploymentJournal({
          ...journal,
          messages: { ...journal.messages, candidate: "candidate\nmessage" },
        }),
      /safe deployment message/,
    );
    assert.throws(
      () => parseDeploymentJournal({ ...journal, workerName: "other-worker" }),
      /deployment journal workerName must equal 'sentry-mcp'/,
    );
  });
});

const transitions = {
  upload: (state) => state,
  malformedOutput: (state) => state,
  cancel: (state) => state,
  candidateCommit: () => "candidate",
  commandFailure: (state) => state,
  promoteCommit: () => "promoted",
  externalReplacement: () => "external",
  restorationFailure: (state) => state,
  restorationCommit: () => "restored",
};

const states = {
  unchanged: snapshot(original, [original]),
  candidate: snapshot(candidate, [original, candidate]),
  promoted: snapshot(promoted, [original, candidate, promoted]),
  restored: snapshot(restored, [original, candidate, promoted, restored]),
  external: snapshot(external, [original, candidate, promoted, external]),
};

function runModelScenario(events) {
  return events.reduce(
    (state, event) => transitions[event](state),
    "unchanged",
  );
}

describe("Cloudflare deployment state model", () => {
  it("accepts state that still matches durable reconciliation", () => {
    assert.deepEqual(
      assertReconciledPredecessor(
        states.promoted,
        journal,
        reconciliationCompletion("promoted", "restore", "verify-promoted"),
      ),
      {
        state: "promoted",
        decision: "restore",
        deploymentId: PROMOTED_DEPLOYMENT,
      },
    );
  });

  it("rejects external state inserted after durable reconciliation", () => {
    assert.throws(
      () =>
        assertReconciledPredecessor(
          states.external,
          journal,
          reconciliationCompletion("unchanged", "unchanged", "restore"),
        ),
      /Cloudflare deployment state changed after durable reconciliation/,
    );
  });

  const scenarios = [
    {
      name: "success",
      events: ["upload", "candidateCommit", "promoteCommit"],
      state: "promoted",
      restoration: "restore",
    },
    {
      name: "post-commit command failure",
      events: ["upload", "candidateCommit", "commandFailure"],
      state: "candidate",
      restoration: "restore",
    },
    {
      name: "malformed output",
      events: ["malformedOutput"],
      state: "unchanged",
      restoration: "unchanged",
    },
    {
      name: "cancellation",
      events: ["upload", "cancel"],
      state: "unchanged",
      restoration: "unchanged",
    },
    {
      name: "external replacement",
      events: [
        "upload",
        "candidateCommit",
        "promoteCommit",
        "externalReplacement",
      ],
      state: "external",
      restoration: "external",
    },
    {
      name: "restoration failure",
      events: [
        "upload",
        "candidateCommit",
        "promoteCommit",
        "restorationFailure",
      ],
      state: "promoted",
      restoration: "restore",
    },
    {
      name: "successful restoration",
      events: [
        "upload",
        "candidateCommit",
        "promoteCommit",
        "restorationCommit",
      ],
      state: "restored",
      restoration: "restored",
    },
  ];

  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const oracleState = runModelScenario(scenario.events);
      assert.equal(oracleState, scenario.state);
      assert.equal(
        classifyDeploymentState(states[oracleState], model),
        scenario.state,
      );
      assert.equal(
        decideRestoration(states[oracleState], model),
        scenario.restoration,
      );
    });
  }

  it("matches exactly one owned state and never restores external state", () => {
    const predicates = [
      isOwnedCandidateAtZero,
      isOwnedPromoted,
      isRestoredPrevious,
      isUnchangedOriginal,
    ];
    const expectedMatches = {
      unchanged: [false, false, false, true],
      candidate: [true, false, false, false],
      promoted: [false, true, false, false],
      restored: [false, false, true, false],
      external: [false, false, false, false],
    };

    for (const [name, deploymentState] of Object.entries(states)) {
      assert.deepEqual(
        predicates.map((predicate) => predicate(deploymentState, model)),
        expectedMatches[name],
      );
    }
    assert.equal(decideRestoration(states.external, model), "external");
  });

  it("reconciles a post-commit failure from state, not command output", () => {
    const failedOutput = jsonl(session(candidateArgs), {
      type: "command-failed",
      version: 1,
      message: "network failed after the deployment commit",
      timestamp: TIMESTAMP,
    });
    assert.throws(
      () =>
        parseWranglerJsonl(failedOutput, {
          type: "version-deploy",
          commandLineArgs: candidateArgs,
          workerTag: WORKER_TAG,
        }),
      /command-failed/,
    );
    assert.equal(classifyDeploymentState(states.candidate, model), "candidate");
    assert.equal(decideRestoration(states.candidate, model), "restore");
  });

  it("hydrates committed transitions from the durable journal", () => {
    for (const [name, deploymentState] of Object.entries(states)) {
      const hydrated = hydrateDeploymentModel(deploymentState, journal);
      const evaluated = evaluateDeployment(deploymentState, journal);
      assert.equal(classifyDeploymentState(deploymentState, hydrated), name);
      assert.equal(evaluated.state, name);
      assert.equal(
        evaluated.decision,
        name === "candidate" || name === "promoted" ? "restore" : name,
      );
    }
  });

  it("does not claim transitions beyond an inserted deployment", () => {
    const inserted = snapshot(promoted, [
      original,
      external,
      candidate,
      promoted,
    ]);
    const hydrated = hydrateDeploymentModel(inserted, journal);

    assert.equal(hydrated.candidate, undefined);
    assert.equal(classifyDeploymentState(inserted, hydrated), "external");
    assert.equal(decideRestoration(inserted, hydrated), "external");
  });

  it("treats wrong ownership evidence as external interference", () => {
    const wrongMessage = snapshot(
      { ...candidate, annotations: { "workers/message": "someone else" } },
      [
        original,
        { ...candidate, annotations: { "workers/message": "someone else" } },
      ],
    );
    const wrongPredecessor = snapshot(candidate, [external, candidate]);
    const statusListRace = snapshot(candidate, [original, candidate, external]);

    for (const deploymentState of [
      wrongMessage,
      wrongPredecessor,
      statusListRace,
    ]) {
      assert.equal(classifyDeploymentState(deploymentState, model), "external");
      assert.equal(decideRestoration(deploymentState, model), "external");
    }
  });
});
