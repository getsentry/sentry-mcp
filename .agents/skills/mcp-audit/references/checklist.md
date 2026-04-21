# MCP Audit Checklist

Use this checklist for repeatable MCP metadata audits in any repository.

## Surface discovery

1. Locate the public tool registry or server registration path.
2. Identify which tools are public versus `internalOnly`, `agentOnly`, experimental, or otherwise gated.
3. Find any repo-local docs, tests, or scripts that already encode MCP metadata rules.
4. Find any generation step that syncs tool definitions, catalogs, or prompt metadata.

## Mutation classification

1. Build an explicit list of tools that can mutate upstream state.
2. Classify each mutation as either:
   - Additive write: creates new state without modifying existing state.
   - Destructive update: changes or overwrites existing state.
3. Treat orchestration tools conservatively based on the strongest child tool they can reach.
4. Treat conditional writes as mutating even if the write happens only on some code paths.
5. If the server framework wraps or transforms tool definitions, verify the exposed `tools/list` metadata instead of trusting only source annotations.

## Spec-facing checks

1. Every tool defines `readOnlyHint`.
2. Every tool defines `openWorldHint`.
3. Every write-capable tool defines `destructiveHint`.
4. Only tools with truly repeatable no-extra-effect behavior define `idempotentHint`.
5. Read-only tools are never marked destructive.
6. Public tool count is checked against any repo or platform limit that exists.
7. Tool descriptions are checked against any repo or platform length limit that exists.
8. Schemas, descriptions, and annotations all match actual behavior.

## Automation expectations

1. Prefer an existing metadata audit command if the repo already has one.
2. If no focused audit exists, add or update a narrow automated check that:
   - captures the mutating-tool inventory
   - validates required hints
   - fails when the inventory drifts
3. Prefer an integration test against the exported server surface when annotations can differ from source declarations.
4. Refresh generated definitions or catalogs after metadata changes if the repo uses them.
5. Finish with the repo's normal quality gate.

## Reporting

1. List every upstream-mutating tool.
2. List every inaccurate hint with file references.
3. State whether count, description-length, and generation checks passed.
4. Note residual uncertainty separately from confirmed findings.
