# @sentry/mcp-server-evals

Evaluation helpers and a local mock stdio runner used when developing and validating the Sentry MCP server.

## Running evals

The suite uses the harness-first `vitest-evals` API through repo-local helpers
in `src/evals/utils`. Keep eval files focused on fixture cases; the helpers
own harness selection, judges, thresholds, timeouts, usage capture, and traces.

```bash
# Requires OPENAI_API_KEY in .env or .env.local
pnpm eval

# Run a single eval file/suite pattern
pnpm --filter @sentry/mcp-server-evals eval search-issues

# Print expanded tool/output detail in the terminal report
pnpm --filter @sentry/mcp-server-evals eval:info
```

Eval runs write `packages/mcp-server-evals/eval-results.json`, which is the
artifact used by both the local report UI and GitHub Actions.

## Writing evals

Use the smallest helper that exercises the behavior you need:

- `describeToolPredictionEval` for fast prediction suites that ask a model to
  predict which MCP tools should be called. The harness output is
  `{ predictedTools, rationale }`; a deterministic judge compares it with
  `expectedTools`.
- `describeMcpToolCallEval` for full MCP harness runs through the mock stdio
  server. Use this when actual tool interception, usage data, and traces matter.
- `describeSearchAgentEval` for embedded search agents that return structured
  query output plus captured tool calls.

```typescript
import { describeToolPredictionEval, FIXTURES } from "./utils";

describeToolPredictionEval("list-projects", [
  {
    input: `What projects do I have access to in ${FIXTURES.organizationSlug}?`,
    expectedTools: [
      {
        name: "find_projects",
        arguments: { organizationSlug: FIXTURES.organizationSlug },
      },
    ],
  },
]);
```

## Local report UI

After running evals, open the report UI with either root shortcut:

```bash
pnpm eval:report
pnpm eval:ui
```

Both commands serve `packages/mcp-server-evals/eval-results.json` with
`vitest-evals serve`.

## CI reporting

`.github/workflows/eval.yml` emits Vitest JSON and JUnit XML, then uses
`getsentry/vitest-evals@v0` to publish the GitHub Actions summary,
annotations, and the `Evaluation Results` check run. The JSON artifact is the
source of truth because it preserves eval scores and metadata; JUnit is kept
for tools that expect XML.

## Mock stdio runner

- Command: `pnpm --filter @sentry/mcp-server-evals start`
- Entry: `src/bin/start-mock-stdio.ts`
- Purpose: Boots the MCP server in-process with MSW mocks enabled for deterministic evals.

### Scopes policy

The mock stdio script grants only the high-level admin scopes that imply all lower permissions via the hierarchy defined in `packages/mcp-server/src/permissions.ts`:

- `org:admin`, `project:admin`, `team:admin`, `member:admin`, `event:admin`
- Plus special non-hierarchical scope: `project:releases`

This keeps permissions minimal and readable while still enabling every tool in eval runs. Avoid enumerating every read/write scope explicitly — rely on the hierarchy to expand implied permissions.

### Notes

- No API keys are logged; MSW handles Sentry API mocking.
- For code changes, ensure `pnpm run tsc && pnpm run lint && pnpm run test` all pass.
- See `docs/adding-tools.md` and `docs/testing.md` for contribution guidance.
