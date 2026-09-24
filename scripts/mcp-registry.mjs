import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const registry = "https://registry.modelcontextprotocol.io/v0.1";

export function createManifest(template, version) {
  // Only stable releases, never arbitrary URLs, refs, or prereleases.
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.trim() !== version
  ) {
    throw new Error(`Expected a stable release version, received: ${version}`);
  }
  const manifest = structuredClone(template);
  manifest.version = version;
  for (const pkg of manifest.packages) pkg.version = version;
  return manifest;
}

async function getJSON(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return response.json();
}

export async function waitForPackage(
  manifest,
  {
    fetcher = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    attempts = 40,
  } = {},
) {
  const pkg = manifest.packages[0];
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.identifier)}/${pkg.version}`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const published = await getJSON(url, fetcher);
    if (published) {
      if (
        published.name !== pkg.identifier ||
        published.version !== pkg.version ||
        published.mcpName !== manifest.name
      ) {
        throw new Error(
          "Published npm package does not match the registry identity/version",
        );
      }
      return;
    }
    if (attempt < attempts - 1) await sleep(15_000);
  }
  throw new Error(
    `npm package ${pkg.identifier}@${pkg.version} is not available; retry after npm publishing succeeds`,
  );
}

export async function checkPublished(manifest, fetcher = fetch) {
  const url = `${registry}/servers/${encodeURIComponent(manifest.name)}/versions/${manifest.version}`;
  const record = await getJSON(url, fetcher);
  if (!record) return false;
  // The registry can migrate the schema URL without changing listing metadata.
  const { $schema: expectedSchema, ...expected } = manifest;
  const { $schema: actualSchema, ...actual } = record.server;
  if (
    !isDeepStrictEqual(actual, expected) ||
    record._meta?.["io.modelcontextprotocol.registry/official"]?.status !==
      "active"
  ) {
    throw new Error(
      `Registry version ${manifest.version} already exists with different metadata or is inactive; publish a new version instead`,
    );
  }
  return true;
}

export async function verifyPublished(manifest, options = {}) {
  const {
    fetcher = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    attempts = 6,
  } = options;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await checkPublished(manifest, fetcher)) return;
    if (attempt < attempts - 1) await sleep(10_000);
  }
  throw new Error(
    `Registry version ${manifest.version} was not found after publishing`,
  );
}

async function main() {
  const [mode, version, output] = process.argv.slice(2);
  const template = JSON.parse(
    readFileSync(new URL("../server.json", import.meta.url), "utf8"),
  );
  const manifest = createManifest(template, version);
  if (mode === "prepare") {
    await waitForPackage(manifest);
    const exists = await checkPublished(manifest);
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `publish=${!exists}\n`);
    console.log(
      exists
        ? "Matching registry version already published"
        : "npm package verified; registry publication required",
    );
  } else if (mode === "verify") {
    await verifyPublished(manifest);
    console.log(`Verified ${manifest.name}@${version} in the MCP Registry`);
  } else {
    throw new Error(
      "Usage: node scripts/mcp-registry.mjs <prepare|verify> <version> [output]",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
