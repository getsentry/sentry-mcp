import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { hashDirectory } from "./hash-directory.mjs";

function withDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), "hash-directory-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("hashDirectory", () => {
  it("is stable across file creation order", () => {
    const first = withDirectory((directory) => {
      mkdirSync(join(directory, "nested"));
      writeFileSync(join(directory, "z.txt"), "z");
      writeFileSync(join(directory, "nested", "a.txt"), "a");
      return hashDirectory(directory);
    });
    const second = withDirectory((directory) => {
      mkdirSync(join(directory, "nested"));
      writeFileSync(join(directory, "nested", "a.txt"), "a");
      writeFileSync(join(directory, "z.txt"), "z");
      return hashDirectory(directory);
    });

    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{64}$/);
  });

  it("binds file paths and contents", () => {
    withDirectory((directory) => {
      writeFileSync(join(directory, "artifact.txt"), "first");
      const first = hashDirectory(directory);
      writeFileSync(join(directory, "artifact.txt"), "second");
      const second = hashDirectory(directory);
      writeFileSync(join(directory, "renamed.txt"), "second");
      const third = hashDirectory(directory);

      assert.notEqual(first, second);
      assert.notEqual(second, third);
    });
  });

  it("rejects empty directories and symbolic links", () => {
    withDirectory((directory) => {
      assert.throws(() => hashDirectory(directory), /at least one file/);
      writeFileSync(join(directory, "target"), "target");
      symlinkSync("target", join(directory, "link"));
      assert.throws(() => hashDirectory(directory), /symbolic link/);
    });
  });

  it("rejects a file replaced with a symbolic link before opening", () => {
    withDirectory((directory) => {
      const artifact = join(directory, "artifact.txt");
      writeFileSync(artifact, "artifact");
      writeFileSync(join(directory, "replacement.txt"), "replacement");

      assert.throws(
        () =>
          hashDirectory(directory, {
            beforeFileOpen(path) {
              if (path === artifact) {
                rmSync(artifact);
                symlinkSync("replacement.txt", artifact);
              }
            },
          }),
        /symbolic link|changed|ELOOP/,
      );
    });
  });

  it("rejects directory membership changes while hashing", () => {
    withDirectory((directory) => {
      writeFileSync(join(directory, "artifact.txt"), "artifact");

      assert.throws(
        () =>
          hashDirectory(directory, {
            beforeMembershipRecheck() {
              writeFileSync(join(directory, "late.txt"), "late");
            },
          }),
        /directory membership changed/,
      );
    });
  });

  it("rejects a regular file replaced after the initial scan", () => {
    withDirectory((directory) => {
      const artifact = join(directory, "artifact.txt");
      const replacement = join(directory, "replacement.txt");
      writeFileSync(artifact, "artifact");
      writeFileSync(replacement, "replacement");

      assert.throws(
        () =>
          hashDirectory(directory, {
            beforeFileOpen(path) {
              if (path === artifact) {
                renameSync(replacement, artifact);
              }
            },
          }),
        /entry changed/,
      );
    });
  });
});
