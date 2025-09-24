#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const docsDir = join(root, "docs");

/** Recursively collect docs files */
function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) files.push(...walk(p));
    else if (e.endsWith(".md") || e.endsWith(".mdc")) files.push(p);
  }
  return files;
}

const files = walk(docsDir);

const problems = [];

for (const file of files) {
  const rel = file.slice(root.length + 1);
  const content = readFileSync(file, "utf8");

  // Strip fenced code blocks to avoid false positives in examples
  const contentNoFences = content.replace(/```[\s\S]*?```/g, "");

  // 1) Flag local Markdown links like [text](./file.md) or [text](../file.mdc)
  const localLinkRe = /\[[^\]]+\]\((\.\.?\/[^)]+)\)/g;
  for (const m of contentNoFences.matchAll(localLinkRe)) {
    // Skip illustrative placeholders
    if (m[1].includes("...")) continue;
    problems.push({
      file: rel,
      type: "local-markdown-link",
      message: `Use @path for local docs instead of Markdown links: ${m[0]}`,
    });
  }

  // 1b) Flag Markdown links that point to @path
  const atMarkdownLinkRe = /\[[^\]]+\]\(@[^)]+\)/g;
  for (const m of contentNoFences.matchAll(atMarkdownLinkRe)) {
    problems.push({
      file: rel,
      type: "atpath-markdown-link",
      message: `Do not wrap @paths in Markdown links: ${m[0]}`,
    });
  }

  // 2) Validate @path references point to real files (only for clear file tokens)
  // Matches @path segments with known extensions or obvious repo files
  const atPathRe = /@([A-Za-z0-9_.\-\/]+\.(?:mdc|md|ts|tsx|js|json))/g;
  for (const m of contentNoFences.matchAll(atPathRe)) {
    const relPath = m[1];
    const abs = join(root, relPath);
    try {
      const st = statSync(abs);
      if (!st.isFile()) {
        problems.push({
          file: rel,
          type: "missing-file",
          message: `@${relPath} is not a file`,
        });
      }
    } catch {
      problems.push({
        file: rel,
        type: "missing-file",
        message: `@${relPath} does not exist`,
      });
    }
  }
}

if (problems.length) {
  console.error("[docs:check] Problems found:\n");
  for (const p of problems) {
    console.error(`- ${p.type}: ${p.file} -> ${p.message}`);
  }
  process.exit(1);
} else {
  console.log("[docs:check] OK: no local Markdown links and all @paths exist.");
}
