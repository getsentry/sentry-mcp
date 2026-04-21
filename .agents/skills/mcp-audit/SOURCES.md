# Sources

This file records the source material synthesized into `mcp-audit`.

## Current source inventory

| Source | Type | Trust tier | Retrieved | Confidence | Contribution | Usage constraints | Notes |
|---|---|---|---|---|---|---|---|
| `docs/adding-tools.md` | repo doc | canonical | 2026-04-21 | high | Defined the local meaning of MCP safety annotations and tool-count limits that shaped the generic checklist | Repo-local semantics may differ elsewhere | Primary metadata semantics input |
| `docs/quality-checks.md` | repo doc | canonical | 2026-04-21 | high | Confirmed the expectation that audits finish with the repo quality gate and regenerated definitions when needed | Repo-local workflow requirement | Used for validation guidance |
| `packages/mcp-core/src/tools/index.ts` | local example | contextual | 2026-04-21 | high | Provided a concrete example of a public tool registry that the generic workflow should discover and audit | Example only, not portable guidance | Reinforced surface-discovery steps |
| `packages/mcp-core/src/tools/tools.test.ts` | local example | contextual | 2026-04-21 | high | Showed the shape of narrow metadata checks that the skill should encourage without hardcoding repo-specific inventories | Example only, not portable guidance | Informed automation guidance |
| `packages/mcp-core/src/server.test.ts` | local example | contextual | 2026-04-21 | high | Demonstrated that client-visible MCP annotations should be verified through the exported server surface, not only source declarations | Example only, not portable guidance | Informed exported-surface validation guidance |
| `../warden/skills/warden/references/configuration.md` | local upstream doc | canonical | 2026-04-21 | high | Confirmed that Warden can reference a repo-local skill by name from `.agents/skills/<name>/SKILL.md` | Warden-specific integration detail | Used to justify repo-local rollout |
| `skill-writer/references/mode-selection.md` | authoring guide | canonical | 2026-04-21 | high | Established `workflow-process` as the correct class for this skill | Applies to skill authoring, not audit execution | Guided structure selection |
| `skill-writer/references/workflow-patterns.md` | authoring guide | canonical | 2026-04-21 | high | Guided the checklist-oriented workflow structure | Applies to skill authoring, not audit execution | Reinforced ordered workflow design |
| `skill-writer/references/examples/workflow-process-skill.md` | authoring guide | contextual | 2026-04-21 | medium | Confirmed the emphasis on preconditions, ordered steps, and failure handling | Example only | Used as style prior art |

## Decisions

1. Keep the skill generic and portable; do not hardcode project-specific commands, paths, or mutation inventories into `SKILL.md`.
2. Put project-specific mutation inventories in repo-local tests or docs rather than the skill body.
3. Treat orchestration tools conservatively and treat conditional writes as mutating.
4. Prefer validating client-visible metadata through the exported MCP surface when the framework can transform tool definitions before exposure.

## Open gaps

1. Re-review the MCP spec and Warden docs when either adds or renames metadata fields so the checklist stays current.
2. Capture a second non-Sentry MCP server example the next time this skill is revised to broaden the portability sample set.

## Changelog

- 2026-04-21: Created `mcp-audit` as a generic workflow-process skill for MCP metadata and compatibility audits.
- 2026-04-21: Added guidance to verify exposed `tools/list` metadata and documented repo-local Warden rollout assumptions.
