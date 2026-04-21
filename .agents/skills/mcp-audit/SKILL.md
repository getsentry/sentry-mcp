---
name: mcp-audit
description: Audit MCP servers for metadata drift and compatibility requirements. Use when reviewing `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, tool counts, description length, generated definitions, or broader MCP spec and directory compliance concerns. Trigger phrases include "audit MCP", "check tool hints", "review readOnlyHint", "validate MCP spec compliance", "run an MCP metadata audit", and "check MCP compatibility in Warden".
---

# MCP Audit

Audit an MCP server implementation for tool metadata drift and MCP-facing compatibility problems.

Read `references/checklist.md` before making changes. `SOURCES.md` is provenance for how this skill was authored, not the audit checklist.

## Workflow

1. Discover the server surface.
   - Find the public tool registry or registration path.
   - Find repo-local docs or tests that define metadata expectations.
   - Find any generation step that syncs tool definitions, prompts, or catalogs.

2. Build or verify the mutating-tool inventory.
   - Review each public tool for upstream writes.
   - Treat orchestration tools such as `use_sentry` conservatively based on the most dangerous child tool they can reach.
   - Treat conditional writes as mutating even if the write only happens on some code paths.
   - Distinguish additive writes (`destructiveHint: false`) from updates to existing upstream state (`destructiveHint: true`).

3. Check MCP safety annotations.
   - Every tool must define `readOnlyHint` and `openWorldHint`.
   - Every tool with `readOnlyHint: false` must also define `destructiveHint`.
   - Only set `idempotentHint` when repeating the same call has no extra effect.
   - Verify client-visible metadata at the exported MCP surface when possible, not only the source declaration.

4. Check other MCP-facing compatibility concerns.
   - Public tool count stays within the repo or platform limit if one exists.
   - Tool descriptions stay within any repo-specific compatibility limit.
   - Generated definitions or prompt catalogs are refreshed after metadata changes.
   - Schemas, descriptions, and annotations match actual behavior.

5. Run validation.
   - Prefer an existing repo-local metadata audit command or test if one exists.
   - Prefer server integration coverage that asserts `tools/list` output when the framework can transform tool metadata before exposure.
   - If none exists, add or update a narrow automated check that captures the mutation inventory and required hints.
   - Run the repository's normal quality gate before closing.

6. Report the result.
   - List every upstream-mutating tool.
   - Call out inaccurate hints with file references.
   - State whether tool-count and description-length checks passed.
   - State whether generated definitions or catalogs were refreshed.
   - Note any residual uncertainty about endpoint behavior or orchestration semantics.

## Failure Handling

- If an endpoint's write semantics are unclear, inspect the API client call site or implementation before changing hints.
- If a tool can both create and update through one entry point, prefer the more conservative hints.
- If the targeted audit passes but broader quality checks fail, separate metadata findings from unrelated failures in the report.
