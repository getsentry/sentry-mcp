---
name: mcp-audit
description: Audit MCP servers for protocol compliance, metadata drift, and compatibility regressions. Use when reviewing tool annotations, tool/result schemas, structured output, lifecycle/init handshake, capabilities, prompts/resources support, transports, auth, security, version drift, or Warden/CI MCP compatibility checks. Trigger phrases include "audit MCP", "check MCP spec compliance", "review tool hints", "validate tools/list", "check initialize handshake", "review prompt or resource capabilities", and "check MCP compatibility in Warden".
---

# MCP Audit

Audit an MCP server against the current released MCP specification and any repo-specific compatibility constraints.

Read `references/spec-baseline.md` and `references/checklist.md` before making changes. Use `references/version-watchpoints.md` when spec drift, draft features, or older protocol targets may matter. `references/common-findings.md` captures recurring failure patterns. `SOURCES.md` is provenance, not the audit checklist.

## Workflow

1. Pin the protocol baseline.
   - Default to the latest released MCP spec revision unless the repo explicitly targets another version.
   - Treat draft and SEP content as watchpoints, not release-blocking requirements, unless the user or repo explicitly asks for draft compatibility.
   - Identify which MCP primitives and utilities the server actually implements: prompts, resources, tools, completions, logging, tasks, or experimental extensions.

2. Audit lifecycle and capability negotiation.
   - Verify `initialize` and `notifications/initialized` behavior, negotiated protocol version, and claimed capabilities.
   - Check that the server only advertises capabilities and sub-capabilities it actually supports, such as `listChanged`, `subscribe`, or task-related capability blocks.
   - For HTTP transports, verify behavior around `MCP-Protocol-Version` after initialization if the repo owns transport handling directly.

3. Audit tools if present.
   - Verify `tools/list` pagination, `notifications/tools/list_changed` if claimed, and client-visible metadata from the exported server surface.
   - Check tool definitions: `name`, `title`, `description`, `icons`, `inputSchema`, `outputSchema`, `annotations`, and `execution.taskSupport`.
   - Check tool result semantics: `content`, `structuredContent`, `isError`, embedded resources, resource links, and the split between protocol errors and tool execution errors.
   - Review safety hints conservatively: `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`.
   - Build the explicit upstream-mutation inventory for write-capable tools.

4. Audit prompts and resources if present.
   - Prompts: capability declaration, `prompts/list` pagination, `prompts/get`, `notifications/prompts/list_changed`, argument handling, and prompt message content types.
   - Resources: capability declaration, `resources/list` pagination, `resources/read`, `resources/templates/list`, `resources/subscribe`, `notifications/resources/list_changed`, `notifications/resources/updated`, URI scheme usage, MIME types, and text/blob encoding.
   - Preserve the spec control hierarchy: prompts are user-controlled, resources are application-controlled, and tools are model-controlled.

5. Audit transports, auth, and security.
   - `stdio`: newline-delimited JSON-RPC over `stdin` and `stdout`, no non-protocol stdout, stderr-only logging, and environment-based credential handling rather than HTTP OAuth flows.
   - HTTP/Streamable HTTP: origin validation, localhost-binding guidance for local deployments, session and protocol-version handling, and HTTP-only auth flows when the server actually supports HTTP.
   - Authorization: protected resource metadata discovery, `WWW-Authenticate` challenges, scope guidance, resource indicators, bearer-token handling, audience validation, and no query-string tokens.
   - Security: input and URI validation, access controls, output sanitization, rate limits and timeouts, consent or sandbox expectations for local servers, and DNS-rebinding or SSRF risk surfaces.

6. Audit version and compatibility drift.
   - Separate true spec violations from intentional older-version targeting or host-specific behavior.
   - Check newer released-spec features that may be missing or mis-modeled, such as icons, tool name guidance, execution or task support, and structured tool output.
   - Note draft-only or SEP-only expectations separately so the audit does not over-enforce unreleased behavior.
   - Check repo-specific compatibility constraints such as tool-count limits, generated definitions, inspector or SDK quirks, and Warden rules.

7. Run validation.
   - Prefer existing integration tests against the exported server surface.
   - If none exist, add or update the narrowest automated check that proves the claimed protocol behavior.
   - Refresh generated definitions or catalogs if the repo uses them.
   - Finish with the repo's normal validation commands when appropriate.

8. Report the result.
   - State the protocol baseline audited.
   - List every primitive and capability the server implements.
   - List every upstream-mutating tool.
   - Separate confirmed violations, compatibility risks, and watchpoints.
   - Call out what was validated via source inspection versus real server behavior.
   - Note any assumptions about older spec targets, client quirks, or host-specific extensions.

## Failure Handling

- If the repo targets an older MCP revision, audit against that version first and record the delta to latest separately.
- If framework adapters transform schemas or annotations, trust the exported wire surface over local declarations.
- If HTTP auth or transport behavior is owned by upstream infrastructure, audit the repo-owned boundary and explicitly mark the remainder as inherited or out of scope.
- If a requirement appears only in a draft or SEP, do not fail the server on it unless the user asked for draft compatibility.
- If a check passes structurally but the real server response differs, treat the wire behavior as authoritative.
