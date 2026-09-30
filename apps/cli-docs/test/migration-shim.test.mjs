import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const docs = readFileSync(
  new URL("../src/content/docs/migrating-from-v3.md", import.meta.url),
  "utf8",
);
const shim = docs.match(/```bash\n(sentry-cli\(\) \{[\s\S]*?\n\})\n```/)?.[1];
assert.ok(shim, "the migration guide must contain its runnable Bash shim");

for (const [name, args, expected] of [
  ["release creation after --org", ["releases", "--org", "acme", "new", "1.0.0"], ["--org", "acme", "release", "new", "1.0.0"]],
  ["bare release list after --org", ["releases", "--org", "acme"], ["--org", "acme", "release", "list"]],
  ["nested deploys after --org", ["releases", "--org", "acme", "deploys", "-r", "1.0.0"], ["--org", "acme", "release", "deploys", "1.0.0"]],
  ["issue resolution after --org", ["issues", "--org", "acme", "resolve", "ISSUE-1"], ["--org", "acme", "issue", "resolve", "ISSUE-1"]],
  ["bare project list after --project", ["projects", "--project", "demo"], ["--project", "demo", "project", "list"]],
  ["release creation without group flags", ["releases", "new", "1.0.0"], ["release", "new", "1.0.0"]],
]) {
  test(name, () => {
    const directory = mkdtempSync(join(tmpdir(), "sentry-migration-shim-"));
    try {
      writeFileSync(join(directory, "sentry"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o700 });
      const result = spawnSync("bash", ["-c", `${shim}\nsentry-cli "$@"`, "--", ...args], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, SENTRY_ALLOW_FAILURE: "" },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split("\n"), expected);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
