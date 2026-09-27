#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

function listEntries(root, directory = root) {
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    const metadata = lstatSync(path, { bigint: true });
    const artifactPath = relative(root, path).split(sep).join("/");
    if (metadata.isSymbolicLink()) {
      throw new Error(`Artifact must not contain a symbolic link: ${path}`);
    }
    if (metadata.isDirectory()) {
      entries.push({ artifactPath: `${artifactPath}/`, metadata, path });
      entries.push(...listEntries(root, path));
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(`Artifact must contain only regular files: ${path}`);
    }
    entries.push({ artifactPath, metadata, path });
  }
  return entries;
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
  );
}

function sameEntry(left, right) {
  return (
    left.artifactPath === right.artifactPath &&
    sameIdentity(left.metadata, right.metadata) &&
    left.metadata.size === right.metadata.size &&
    left.metadata.mtimeNs === right.metadata.mtimeNs
  );
}

/** Hash a directory's sorted paths and exact regular-file bytes. */
export function hashDirectory(directory, hooks = {}) {
  const root = resolve(directory);
  const metadata = lstatSync(root, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Artifact path must be a real directory");
  }
  const entries = listEntries(root);
  const files = entries.filter((entry) => entry.metadata.isFile());
  if (files.length === 0) {
    throw new Error("Artifact directory must contain at least one file");
  }

  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  for (const { artifactPath, metadata: listedMetadata, path } of files) {
    hooks.beforeFileOpen?.(path);
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = fstatSync(descriptor, { bigint: true });
      const pathBefore = lstatSync(path, { bigint: true });
      if (
        !before.isFile() ||
        !pathBefore.isFile() ||
        !sameIdentity(listedMetadata, before) ||
        !sameIdentity(before, pathBefore)
      ) {
        throw new Error(
          `Artifact entry changed while hashing: ${artifactPath}`,
        );
      }
      hash.update(
        `file\0${Buffer.byteLength(artifactPath)}\0${artifactPath}\0${before.size}\0`,
      );
      for (;;) {
        const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytesRead === 0) {
          break;
        }
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = fstatSync(descriptor, { bigint: true });
      const pathAfter = lstatSync(path, { bigint: true });
      if (
        !sameIdentity(before, after) ||
        !sameIdentity(after, pathAfter) ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs
      ) {
        throw new Error(`Artifact changed while hashing: ${artifactPath}`);
      }
      hash.update("\0");
    } finally {
      closeSync(descriptor);
    }
  }
  hooks.beforeMembershipRecheck?.();
  const finalRootMetadata = lstatSync(root, { bigint: true });
  const finalEntries = listEntries(root);
  if (
    !sameIdentity(metadata, finalRootMetadata) ||
    metadata.mtimeNs !== finalRootMetadata.mtimeNs ||
    entries.length !== finalEntries.length ||
    entries.some((entry, index) => !sameEntry(entry, finalEntries[index]))
  ) {
    throw new Error("Artifact directory membership changed while hashing");
  }
  return hash.digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("Usage: hash-directory.mjs <directory>");
    }
    process.stdout.write(`${hashDirectory(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
