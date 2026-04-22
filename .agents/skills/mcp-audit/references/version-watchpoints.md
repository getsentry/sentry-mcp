# Version Watchpoints

Use this reference to keep released-spec requirements separate from newer or unreleased MCP changes.

## Audit stance

1. Default enforcement target:
   - the latest released MCP spec when the repo does not pin a version
2. If the repo pins an older released version:
   - audit that version first
   - report the delta to latest separately
3. If a behavior exists only in a draft or SEP:
   - treat it as a watchpoint, not a release-blocking failure, unless the user or repo explicitly asks for draft compatibility

## Released baseline at retrieval time

- Latest released spec: `2025-11-25`

Key areas worth re-checking on older servers:

1. richer tool metadata such as `icons`
2. tool execution metadata such as `execution.taskSupport`
3. structured tool output expectations around `outputSchema` and `structuredContent`
4. updated authorization discovery and challenge guidance
5. newer tool naming guidance
6. experimental tasks support and adjacent task-related metadata

## Prior released baseline likely to appear in older repos

- `2025-06-18`

Key compatibility deltas from older implementations:

1. structured tool output became a first-class released concept
2. OAuth and protected-resource guidance became more explicit
3. protocol-version handling became more important for HTTP transports
4. JSON-RPC batching was removed from the released transport model

## Draft watchpoints at retrieval time

The current draft stream includes changes that are useful to monitor but should not be enforced by default on a released-spec audit:

1. `extensions` fields in client or server capabilities
2. `_meta` trace-context conventions for OpenTelemetry propagation
3. host- or SDK-specific transport conventions not required by the released spec

## Reporting rule

Always separate findings into:

1. confirmed violation of the targeted released spec
2. compatibility risk against the latest released spec
3. draft or SEP watchpoint

This prevents the audit from overstating unreleased behavior as a current protocol failure.
