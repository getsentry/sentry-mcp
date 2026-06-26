# Spec Baseline

Use this reference to anchor `mcp-audit` on the current released MCP specification before applying repo-specific rules.

## Released baseline

- Latest released MCP spec at retrieval time: `2025-11-25`
- Audit default:
  - Use the latest released spec when the repo does not pin an older revision.
  - If the repo explicitly targets an older revision, audit against that revision first and report the delta to latest separately.
  - Treat draft and SEP material as watchpoints unless the repo or user explicitly asks for draft compatibility.

## Control hierarchy

The server primitives are not interchangeable. Preserve the intended control plane:

- Prompts are user-controlled.
- Resources are application-controlled.
- Tools are model-controlled.

If a server blurs those boundaries, call it out explicitly because it affects security and UX expectations.

## Lifecycle and capabilities

Audit these first:

1. `initialize` request and response behavior
2. `notifications/initialized`
3. Negotiated protocol version
4. Claimed capabilities and sub-capabilities
5. Transport-specific post-init behavior when the repo owns transport details

Common failures:

- advertising `listChanged` or `subscribe` without the corresponding behavior
- claiming a primitive the server does not actually implement
- checking only local declarations while the framework exports different wire metadata

## Tools baseline

The current released spec expects tool definitions to be treated as wire-visible protocol objects, not just internal metadata.

Check:

1. `tools/list`, including pagination when tool sets can grow
2. `notifications/tools/list_changed` when the server claims it
3. top-level metadata:
   - `name`
   - `title`
   - `description`
   - `icons`
   - `inputSchema`
   - `outputSchema`
   - `annotations`
   - `execution.taskSupport`
4. tool results:
   - `content`
   - `structuredContent`
   - `isError`
   - resource links or embedded resources when used

Important result rules:

- `structuredContent` should match `outputSchema` when `outputSchema` is declared.
- Business or execution failures should generally surface as tool-call results, while JSON-RPC errors are reserved for protocol-level failures.
- Safety hints are advisory to clients, so the exported wire value matters more than the source declaration if a framework rewrites it.

## Prompts and resources baseline

If the server implements prompts, audit:

1. prompt capability declaration
2. `prompts/list`
3. `prompts/get`
4. pagination if the prompt catalog can grow
5. `notifications/prompts/list_changed` if claimed

If the server implements resources, audit:

1. resource capability declaration
2. `resources/list`
3. `resources/read`
4. `resources/templates/list` if templates exist
5. `resources/subscribe` and `notifications/resources/updated` if claimed
6. `notifications/resources/list_changed` if claimed
7. URI usage, MIME types, and text/blob encoding

## Transport, auth, and security baseline

### `stdio`

- Protocol messages stay on stdout.
- Logging and diagnostics stay on stderr.
- Authentication is typically environment- or local-config-driven, not OAuth redirect-driven.

### HTTP and Streamable HTTP

- Validate Origin headers to reduce DNS-rebinding risk.
- Use safe binding defaults for local servers.
- Honor the released spec's version-negotiation and transport expectations when the repo owns them directly.

### Authorization

When HTTP auth applies, check:

1. protected resource metadata discovery
2. `WWW-Authenticate` challenges
3. scope and resource-indicator behavior
4. bearer-token handling
5. audience binding where applicable
6. no query-string tokens

### Security

Check:

1. input and URI validation
2. least-privilege access controls
3. output sanitization
4. SSRF and DNS-rebinding exposure
5. timeouts, limits, and abuse controls
6. consent and sandbox expectations for local servers

## Released-version watchpoints

The latest released spec added or clarified several areas that older server implementations may miss:

- richer tool metadata such as `icons`
- tool execution metadata such as `execution.taskSupport`
- structured tool output expectations around `outputSchema` and `structuredContent`
- newer authorization discovery and challenge guidance
- updated tool naming guidance

Use `references/version-watchpoints.md` to keep these changes separate from draft-only expectations.
