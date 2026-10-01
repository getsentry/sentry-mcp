import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKER = "sentry-mcp";

function active(deployment) {
  if (
    !deployment ||
    !UUID.test(deployment.id) ||
    deployment.versions?.length !== 1 ||
    deployment.versions[0].percentage !== 100 ||
    !UUID.test(deployment.versions[0].version_id)
  ) {
    throw new Error("Expected a single active Worker version at 100% traffic");
  }
  return { id: deployment.id, version: deployment.versions[0].version_id };
}

export function capturePrevious(deployments, marker) {
  if (!Array.isArray(deployments) || !marker) {
    throw new Error("Missing deployment history or run identity");
  }
  return { previous: active(deployments[0]), marker };
}

export function verifyCandidate(deployments, journal) {
  if (!Array.isArray(deployments) || !journal?.previous || !journal.marker) {
    throw new Error("Missing deployment history or previous-version journal");
  }
  const candidate = active(deployments[0]);
  if (
    candidate.id === journal.previous.id ||
    deployments[0].annotations?.["workers/message"] !== journal.marker ||
    deployments[1]?.id !== journal.previous.id ||
    active(deployments[1]).version !== journal.previous.version
  ) {
    throw new Error(
      "Deployment ownership or prior version changed; refusing recovery",
    );
  }
  return { ...journal, candidate };
}

export function assertOwnedCandidate(deployments, journal) {
  const actual = verifyCandidate(deployments, journal);
  if (
    !journal.candidate ||
    actual.candidate.id !== journal.candidate.id ||
    actual.candidate.version !== journal.candidate.version
  ) {
    throw new Error(
      "Production no longer runs this job's candidate; refusing recovery",
    );
  }
  return journal.previous.version;
}

async function listDeployments(env) {
  if (
    !/^[0-9a-f]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN
  ) {
    throw new Error("Cloudflare account ID and API token are required");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER}/deployments?per_page=2`,
    {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error("Cloudflare deployment lookup failed");
  }
  const body = await response.json();
  if (body.success !== true || !Array.isArray(body.result?.deployments)) {
    throw new Error("Cloudflare returned an invalid deployment list");
  }
  return body.result.deployments;
}

function runMarker(env) {
  if (
    !/^\d+$/.test(env.GITHUB_RUN_ID ?? "") ||
    !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
    !/^[0-9a-f]{40}$/.test(env.TESTED_SHA ?? "")
  ) {
    throw new Error("Invalid GitHub run identity");
  }
  return `toolkit-mcp:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}:${env.TESTED_SHA}`;
}

export async function restorePreviousVersion(
  deployments,
  journal,
  env,
  { list = listDeployments, spawn = spawnSync } = {},
) {
  const previous = assertOwnedCandidate(deployments, journal);
  if (!UUID.test(previous)) {
    throw new Error("Invalid captured previous version");
  }
  const child = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "versions",
      "deploy",
      `${previous}@100`,
      "--yes",
      "--message",
      `Toolkit recovery ${env.GITHUB_RUN_ID}`,
    ],
    {
      cwd: join(import.meta.dirname, "../packages/mcp-cloudflare"),
      env,
      stdio: "inherit",
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0)
    throw new Error("Explicit previous-version deployment failed");
  const recovered = active((await list(env))[0]);
  if (recovered.version !== previous) {
    throw new Error(
      "Cloudflare did not activate the captured previous version",
    );
  }
}

async function main(command, env) {
  if (!env.RUNNER_TEMP) {
    throw new Error("RUNNER_TEMP is required");
  }
  const path = join(env.RUNNER_TEMP, "mcp-production-deployment.json");
  const deployments = await listDeployments(env);
  if (command === "capture") {
    const journal = capturePrevious(deployments, runMarker(env));
    await writeFile(path, JSON.stringify(journal), { mode: 0o600 });
    return;
  }
  const journal = JSON.parse(await readFile(path, "utf8"));
  if (journal.marker !== runMarker(env)) {
    throw new Error("Deployment journal belongs to another run");
  }
  if (command === "verify") {
    await writeFile(
      path,
      JSON.stringify(verifyCandidate(deployments, journal)),
      { mode: 0o600 },
    );
    return;
  }
  if (command === "recover") {
    await restorePreviousVersion(deployments, journal, env);
    return;
  }
  throw new Error("Unknown Cloudflare deployment operation");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv[2], process.env).catch((error) => {
    // Keep API responses and credentials out of CI logs.
    console.error(error.message);
    process.exitCode = 1;
  });
}
