# Common Findings

Use this reference to avoid overly narrow audits and to separate common MCP failure modes from true repo-specific edge cases.

## Lifecycle and capability drift

1. The server claims a primitive or sub-capability that it does not actually implement.
2. `listChanged` is declared but no corresponding notification is ever emitted.
3. `subscribe` is declared for resources but subscriptions are not supported end to end.
4. The transport or framework exports different capability data than the local source definitions imply.

## Tool definition and result problems

1. A mutating tool is marked `readOnlyHint: true`.
2. A networked or externally dependent tool is marked `openWorldHint: false`.
3. `destructiveHint` is missing on write-capable tools.
4. `idempotentHint` is applied to tools whose repeated calls have additional effect.
5. The exported `tools/list` metadata differs from the local source declaration.
6. `outputSchema` is declared but `structuredContent` is absent or does not match it.
7. Business-logic failures are surfaced as protocol errors instead of tool-call failures.
8. Tool names or titles drift from the targeted spec revision.
9. The server claims task support in tool metadata without the broader task flow it depends on.

## Prompt and resource problems

1. Prompt or resource capabilities are claimed but their list or get or read methods are missing.
2. Pagination behavior is not implemented even though catalogs can grow materially.
3. Resource templates exist but are not exposed through template-listing APIs.
4. URI handling is ad hoc, ambiguous, or unsafe.
5. MIME type, text encoding, or blob handling is inconsistent with actual payloads.

## Transport, auth, and security problems

1. A `stdio` server writes logs or banners to stdout.
2. A local HTTP server does not validate Origin headers.
3. Tokens are accepted through query parameters.
4. HTTP auth guidance is copied into a pure `stdio` server where it does not apply.
5. Protected-resource metadata or `WWW-Authenticate` guidance is incomplete for HTTP servers.
6. Local servers assume trusted clients without documenting consent or sandbox expectations.
7. Input, URI, or resource fetch paths create avoidable SSRF or DNS-rebinding exposure.

## Compatibility and drift problems

1. The audit applies the latest spec to a repo that intentionally targets an older revision, but does not separate true violations from version delta.
2. Draft-only or SEP-only expectations are enforced as if they were released requirements.
3. Repo-specific compatibility constraints such as tool-count limits, generated definitions, or Warden rules are skipped because the audit stops at the protocol spec.
4. The audit checks local source declarations but never verifies what a real client sees through the exported MCP surface.
