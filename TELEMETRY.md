# Telemetry

## Goal

Use this when investigating Sentry MCP production incidents across the
Cloudflare HTTP server, stdio package, MCP tools, OAuth flows, and test-client
agent mode.

Primary backend: Sentry Logs, Issues, Spans/Traces, and Metrics in the MCP
server projects. Start with a Sentry event, trace ID, route, user, client
family, OAuth symptom, tool name, resource URL, or GenAI/model symptom, then use
the pivots and recipes below.

## Where To Query

| Starting Point | Query Surface | Pivot | Answers | Next Step |
| -------------- | ------------- | ----- | ------- | --------- |
| `trace_id` from an issue, span, or log | Sentry Traces and Logs | `span_id` | full request/tool timeline and failing span | inspect child spans and logs |
| Sentry `event_id` | Sentry Issue/Event | `trace_id`, `http.route`, `gen_ai.tool.name` | exception context and owning request/tool | query trace logs |
| HTTP route or status symptom | Sentry Metrics and Logs | `http.route`, `http.response.status_code` | route volume, status mix, local rate limits | inspect matching traces |
| OAuth sign-out or refresh symptom | Sentry Metrics and Logs | `app.client.family`, `app.oauth.*` | refresh outcome, revoked grants, client family | inspect user trace or request logs |
| MCP tool name | Sentry Spans and Issues | `gen_ai.tool.name` | failing or slow tool calls | inspect tool span and Sentry API spans |
| Sentry resource URL/type | Sentry Spans | `app.resource.type` | `get_sentry_resource` dispatch behavior | inspect resolved type and downstream tool |
| Agent/model/token symptom | Sentry Spans | `gen_ai.*` | provider, model, token, and agent behavior | inspect agent and tool spans |
| Client or transport symptom | Sentry Logs, Spans, Metrics | `app.transport`, `app.client.family`, `user_agent.original` | stdio vs HTTP, client bucket, and request family | compare route or OAuth metrics |

## Investigation Pivots

| Pivot | Meaning | Found In | First Query |
| ----- | ------- | -------- | ----------- |
| `trace_id` | one request, tool call, or agent run trace | issues, logs, spans | open trace |
| `span_id` | one request, tool, model, or API span | logs, spans | inspect span |
| `event_id` | captured Sentry error | Sentry issue/event | open event |
| `user.id` | authenticated Sentry user ID | events, logs, metrics | user request or OAuth history |
| `http.route` | normalized Cloudflare route template | metrics, logs, spans | route health |
| `http.response.status_code` | final HTTP response code | metrics, logs, spans | response distribution |
| `app.response.reason` | application local response reason | metrics | local rate-limit diagnosis |
| `app.rate_limit.scope` | local rate-limit scope | metrics | IP vs user rate limits |
| `app.route.group` | coarse route family | metrics | `mcp`, `oauth`, `chat`, `search` |
| `app.transport` | MCP transport | tags, spans | `http`, `sse`, or `stdio` |
| `mcp.session.id` | MCP session identity | spans | session timeline |
| `gen_ai.tool.name` | MCP tool being called | spans, issues | tool timeline |
| `app.resource.type` | resolved Sentry resource type | spans | resource dispatch |
| `app.constraint.organization_slug` | active organization constraint | spans | constrained session behavior |
| `app.constraint.project_slug` | active project constraint | spans | constrained session behavior |
| `gen_ai.tool.call.arguments.<key>` | effective tool arguments | spans | called tool input |
| `app.client.family` | bucketed MCP client family | metrics | client-specific OAuth behavior |
| `app.oauth.token_exchange.outcome` | OAuth refresh outcome | metrics | token refresh diagnosis |
| `app.oauth.grant_revoked.reason` | wrapper grant revoke reason | metrics | sign-out diagnosis |
| `app.oauth.probe.status_code` | upstream probe HTTP status | metrics | Sentry token validity probe result |
| `app.oauth.probe.reason` | indeterminate probe bucket | metrics | upstream instability |
| `app.upstream.host` | configured Sentry host | tags | host-specific behavior |
| `app.server.version` | MCP server package version | tags | release/version behavior |
| `gen_ai.provider.name` | GenAI provider | spans, tags | provider-specific model behavior |
| `gen_ai.request.model` | requested GenAI model | spans | model-specific behavior |
| `user_agent.original` | original HTTP user agent | request data, spans | client identification |

## Query Recipes

Trace log history after opening a Sentry event or span.

```text
dataset=logs query='trace_id:"<trace_id>"'
fields=timestamp,level,message,trace_id,span_id,http.route,http.response.status_code,app.request.duration_ms,error.type,exception.message
sort=timestamp
```

Captured errors for a route, tool, or OAuth symptom.

```text
dataset=issues query='http.route:"<route>" OR gen_ai.tool.name:"<tool_name>" OR app.oauth.grant_revoked.reason:"<reason>"'
fields=timestamp,event_id,trace_id,http.route,gen_ai.tool.name,app.oauth.grant_revoked.reason,error.type,exception.message
sort=-timestamp
```

HTTP response rates by route and status.

```text
dataset=metrics query='metric:app.server.response http.route:"<route>"'
fields=timestamp,metric,http.request.method,http.route,http.response.status_code,app.response.status_class,app.route.group,value
aggregate=sum(value) by http.route,http.response.status_code
```

Local rate-limit volume and scope.

```text
dataset=metrics query='metric:app.server.response app.response.reason:local_rate_limit'
fields=timestamp,metric,http.route,app.rate_limit.scope,user.id,value
aggregate=sum(value) by http.route,app.rate_limit.scope
```

OAuth refresh outcomes by client family.

```text
dataset=metrics query='metric:app.oauth.token_exchange'
fields=timestamp,metric,app.oauth.token_exchange.outcome,app.oauth.grant.shape,app.client.family,app.oauth.probe.status_code,app.oauth.probe.reason,user.id,value
aggregate=sum(value) by app.oauth.token_exchange.outcome,app.client.family
```

Grant revocations for sign-out reports.

```text
dataset=metrics query='metric:app.oauth.grant_revoked user.id:"<user_id>"'
fields=timestamp,metric,app.oauth.grant_revoked.reason,app.client.family,user.id,value
aggregate=sum(value) by app.oauth.grant_revoked.reason,app.client.family
```

Register and callback volume by client family.

```text
dataset=metrics query='metric:app.oauth.register OR metric:app.oauth.callback_completed'
fields=timestamp,metric,app.client.family,value
aggregate=sum(value) by metric,app.client.family
```

Tool execution timeline for a slow or failing tool.

```text
dataset=spans query='gen_ai.tool.name:"<tool_name>"'
fields=timestamp,trace,span_id,span.op,span.duration,gen_ai.tool.name,app.constraint.organization_slug,app.constraint.project_slug,gen_ai.tool.call.arguments.organizationSlug,gen_ai.tool.call.arguments.projectSlugOrId,error.type
sort=-timestamp
```

Resource dispatch behavior for `get_sentry_resource`.

```text
dataset=spans query='app.resource.type:"<resource_type>"'
fields=timestamp,trace,span_id,span.duration,app.resource.type,gen_ai.tool.name,error.type
sort=-timestamp
```

Agent/model calls for provider, token, or cost symptoms.

```text
dataset=spans query='has:gen_ai.provider.name OR has:gen_ai.request.model'
fields=timestamp,trace,span_id,span.duration,gen_ai.provider.name,gen_ai.request.model,gen_ai.operation.name,gen_ai.usage.input_tokens,gen_ai.usage.output_tokens,error.type
sort=-timestamp
```

Stdio sessions by configured host or mode.

```text
dataset=spans query='app.transport:stdio app.upstream.host:"<host>"'
fields=timestamp,trace,span_id,app.server.version,app.server.mode.agent,app.server.mode.experimental,app.url.full,error.type
sort=-timestamp
```

## Domains

### Cloudflare HTTP Server

The hosted MCP server returned an unexpected status, rate-limited a customer, or
logged a request problem.

Metrics: `app.server.response`

Attributes: `http.request.method`, `http.route`,
`http.response.status_code`, `app.response.status_class`,
`app.route.group`, `app.response.reason`, `app.rate_limit.scope`,
`app.request.duration_ms`

### OAuth And Client Registration

Users report sign-outs, refresh loops, DCR churn, or callback/register
imbalance.

Metrics: `app.oauth.token_exchange`, `app.oauth.grant_revoked`,
`app.oauth.callback_completed`, `app.oauth.register`

Attributes: `app.oauth.token_exchange.outcome`, `app.oauth.grant.shape`,
`app.oauth.probe.status_code`, `app.oauth.probe.reason`,
`app.oauth.grant_revoked.reason`, `app.client.family`, `user.id`

### MCP Tool Execution

A tool is slow, failing, affected by session constraints, or calling the wrong
Sentry API path.

Spans: tool call spans and downstream Sentry API spans

Attributes: `gen_ai.tool.name`, `mcp.session.id`,
`app.constraint.organization_slug`, `app.constraint.project_slug`,
`app.transport`, `user.id`

### Resource Resolution

`get_sentry_resource` routes a URL or ID to the wrong resource handler, or a
supported-looking URL returns guidance instead of data.

Spans: `get_sentry_resource` tool span and downstream resource tool span

Attributes: `app.resource.type`, `gen_ai.tool.name`, `trace_id`, `span_id`

### Stdio Transport

Local package startup, host selection, agent mode, experimental mode, or token
resolution behaves differently than the hosted server.

Attributes: `app.server.version`, `app.transport`, `app.server.mode.agent`,
`app.server.mode.experimental`, `app.upstream.host`, `app.url.full`

### Agent And GenAI

The test client or embedded agent has provider, model, token, or tool-call
issues.

Spans: GenAI agent/model/tool spans

Attributes: `gen_ai.provider.name`, `gen_ai.request.model`,
`gen_ai.operation.name`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.tool.name`

## Configuration

| Setting | Controls | Default |
| ------- | -------- | ------- |
| `VITE_SENTRY_DSN` | Cloudflare Sentry telemetry | disabled when unset |
| `VITE_SENTRY_ENVIRONMENT` | Cloudflare Sentry environment | development |
| `SENTRY_DSN` | stdio and Node telemetry | disabled when unset |
| `SENTRY_RELEASE` | stdio release tag | unset |
| `SENTRY_HOST` | upstream Sentry host and `app.upstream.host` | `sentry.io` |
| `NODE_ENV` | stdio environment | production fallback in packaged runtime |

## Attribute Notes

- `http.*`, `network.*`, and `gen_ai.*` fields follow OpenTelemetry semantic
  conventions where applicable.
- `mcp.*` fields are reserved for current or draft OpenTelemetry MCP semantic
  attributes, such as `mcp.method.name`, `mcp.protocol.version`,
  `mcp.resource.uri`, and `mcp.session.id`.
- `app.*` fields are Sentry MCP application-owned attributes for product
  concepts that are not part of the MCP semantic convention, such as OAuth
  outcomes, route groups, constraints, and local response reasons.
- `gen_ai.tool.call.arguments.<key>` intentionally extends GenAI semconv with
  per-key tool arguments after constraints.
- Keep metric attributes low-cardinality. Avoid raw URLs, tokens, prompts,
  full request bodies, or other high-cardinality or sensitive values.
- Do not log secrets. Authorization headers and access tokens must remain
  scrubbed.
- Update this document, `docs/monitoring.md`, and
  `packages/mcp-core/src/internal/agents/tools/data/mcp.json` when adding or
  renaming telemetry fields. Do not add unit tests solely to assert telemetry
  attribute spelling.

## References

- `docs/monitoring.md`
- `docs/oauth-signout-playbook.md`
- `docs/error-handling.md`
- `packages/mcp-cloudflare/src/server/metrics.ts`
- `packages/mcp-cloudflare/src/server/oauth/helpers.ts`
- `packages/mcp-core/src/internal/agents/tools/data/mcp.json`
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry MCP semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/)
