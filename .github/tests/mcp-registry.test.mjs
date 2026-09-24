import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  checkPublished,
  createManifest,
  verifyPublished,
  waitForPackage,
} from "../../scripts/mcp-registry.mjs";

const template = JSON.parse(
  readFileSync(new URL("../../server.json", import.meta.url), "utf8"),
);
const manifest = createManifest(template, "0.41.0");
const npmPackage = {
  name: "@sentry/mcp-server",
  version: "0.41.0",
  mcpName: template.name,
};
const record = () => ({
  server: structuredClone(manifest),
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
});
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
const noSleep = async () => {};

// No network requests, credentials, or actual registry publishing in tests.
test("render release version without mutating the source manifest", () => {
  assert.equal(manifest.version, "0.41.0");
  assert.equal(manifest.packages[0].version, "0.41.0");
  assert.equal(template.version, "0.40.0");
  assert.deepEqual(manifest.remotes, [
    { type: "streamable-http", url: "https://mcp.sentry.dev/mcp" },
  ]);
  assert.equal(manifest.packages[0].identifier, "@sentry/mcp-server");
  assert.equal(manifest.name, "io.github.getsentry/sentry-mcp");
});

test("reject prereleases, arbitrary refs, URL/path injection and noncanonical versions", () => {
  for (const version of [
    "",
    "latest",
    "main",
    "v0.41.0",
    "0.41.0-beta.1",
    "01.2.3",
    "0.41.0/../../latest",
    "$(echo nope)",
    "0.41.0\n",
  ]) {
    assert.throws(() => createManifest(template, version), /stable release/);
  }
});

test("wait for the exact npm version before allowing publication", async () => {
  let requests = 0;
  let sleeps = 0;
  await waitForPackage(manifest, {
    fetcher: async (url) => {
      assert.equal(
        url,
        "https://registry.npmjs.org/%40sentry%2Fmcp-server/0.41.0",
      );
      return requests++ === 0 ? json({}, 404) : json(npmPackage);
    },
    sleep: async () => {
      sleeps++;
    },
  });
  assert.equal(requests, 2);
  assert.equal(sleeps, 1);
});

test("missing npm publication fails after bounded retries", async () => {
  let requests = 0;
  await assert.rejects(
    waitForPackage(manifest, {
      fetcher: async () => {
        requests++;
        return json({}, 404);
      },
      sleep: noSleep,
      attempts: 2,
    }),
    /not available/,
  );
  assert.equal(requests, 2);
});

test("reject npm identity or version mismatches", async () => {
  for (const override of [
    { name: "other" },
    { version: "0.40.0" },
    { mcpName: "other" },
    { mcpName: undefined },
  ]) {
    await assert.rejects(
      waitForPackage(manifest, {
        fetcher: async () => json({ ...npmPackage, ...override }),
      }),
      /does not match/,
    );
  }
});

test("only 404 means a registry version needs publishing", async () => {
  assert.equal(
    await checkPublished(manifest, async (url) => {
      assert.equal(
        url,
        "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.getsentry%2Fsentry-mcp/versions/0.41.0",
      );
      return json({}, 404);
    }),
    false,
  );
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      checkPublished(manifest, async () => json({}, status)),
      /HTTP/,
    );
  }
});

test("matching existing record is safe to rerun, including a migrated schema", async () => {
  const existing = record();
  existing.server.$schema = "https://example.com/new-schema.json";
  assert.equal(
    await checkPublished(manifest, async () => json(existing)),
    true,
  );
});

test("immutable conflicts fail rather than silently skipping changes", async () => {
  const variants = [record(), record(), record()];
  delete variants[0].server.remotes;
  variants[1].server.packages[0].version = "0.25.0";
  variants[2]._meta["io.modelcontextprotocol.registry/official"].status =
    "deleted";
  for (const existing of variants) {
    await assert.rejects(
      checkPublished(manifest, async () => json(existing)),
      /already exists/,
    );
  }
});

test("verify exact version after propagation, even if a newer release is latest", async () => {
  let requests = 0;
  const existing = record();
  existing._meta["io.modelcontextprotocol.registry/official"].isLatest = false;
  await verifyPublished(manifest, {
    fetcher: async () => (requests++ === 0 ? json({}, 404) : json(existing)),
    sleep: noSleep,
  });
  assert.equal(requests, 2);
  await assert.rejects(
    verifyPublished(manifest, {
      fetcher: async () => json({}, 404),
      sleep: noSleep,
      attempts: 2,
    }),
    /not found after publishing/,
  );
});

test("network and npm service failures cannot permit publishing", async () => {
  await assert.rejects(
    waitForPackage(manifest, { fetcher: async () => json({}, 500) }),
    /HTTP 500/,
  );
  await assert.rejects(
    waitForPackage(manifest, {
      fetcher: async () => {
        throw new Error("timeout");
      },
    }),
    /timeout/,
  );
});
