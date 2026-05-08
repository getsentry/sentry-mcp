# Flue Hooks

Flue is the agent harness we use for repository automation hooks. Start with GitHub Actions for hooks that are triggered by GitHub events, then move to a hosted Flue target when an external service needs to call an HTTP endpoint.

## Deployment Choice

Use GitHub Actions for the first issue triage hook because:

- GitHub emits an `issues.opened` event directly to Actions.
- `GITHUB_TOKEN` is available without creating a separate OAuth app or webhook secret.
- The local Flue sandbox can read the checked-out repository and load `AGENTS.md` plus `.agents/skills`.
- `@flue/sdk/node` command grants can expose `gh` without putting the token in the agent prompt.

Use Cloudflare Workers when the trigger is a real webhook, for example a Sentry issue alert. Flue has first-class `flue build --target cloudflare` support, Durable Object-backed sessions, and Worker routes at `/agents/<agent-name>/<id>`.

Use a generic Node host only when we need provider-specific hosting. Flue's Node build produces `dist/server.mjs`, which can run anywhere a long-lived Node process is supported.

Vercel is not the first choice for this repository because Flue's documented hosted targets are Cloudflare and generic Node. We can still revisit it through the Node target if needed.

## Issue Triage Hook

The first hook lives in:

- `.flue/agents/issue-triage.ts` for the Flue agent handler.
- `.agents/skills/issue-triage/SKILL.md` for reusable triage instructions.
- `.github/workflows/issue-triage.yml` for the `issues.opened` trigger.

The handler runs the triage through one larger `issue-triage` skill with deterministic stages. Before each model stage, TypeScript fetches a fresh trusted context object containing the current issue snapshot and repository labels. The model receives that context, the stage name, prior stage results, and a typed result schema.

The stages are:

1. Search for duplicate issues.
2. Close confirmed duplicates with a comment pointing at the canonical issue.
3. Prepare a repository checkout for diagnosis. GitHub Actions clones the default branch with `actions/checkout`; the handler can fall back to `gh repo clone` if no checkout exists.
4. Diagnose and validate the report using repository context and targeted commands.
5. Apply labels, comments, and issue title/body cleanup. When it rewrites the body, it keeps the original report in an `Original Report` footer.

The workflow needs:

- Node.js 22. The workflow sets this up with `actions/setup-node`.
- `OPENAI_API_KEY` as a GitHub Actions secret.
- Optional `FLUE_TRIAGE_MODEL` as a GitHub Actions variable. Defaults to `openai/gpt-5`.

  Reasoning models work despite a known pi-ai bug because the agent installs a small `onPayload` hook on the Flue session's pi-agent-core harness that adds `include: ["reasoning.encrypted_content"]` to every OpenAI Responses request. Without it, every multi-turn call against `openai/gpt-5` (or any other reasoning model) 404s with `Items are not persisted when 'store' is set to false`: [`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono) hardcodes `store: false` on the OpenAI Responses API while still replaying the `rs_*` reasoning IDs from earlier turns. With encrypted content inlined the replay carries the full reasoning blob, so OpenAI never has to look the IDs up. Drop the hook once @flue/sdk exposes [`reasoning`/`thinkingLevel`](https://github.com/withastro/flue/pull/69) (merged into Flue `main` but unreleased) or pi-ai stops hardcoding `store: false` ([badlogic/pi-mono#3369](https://github.com/badlogic/pi-mono/issues/3369), [pi-mono#1504](https://github.com/badlogic/pi-mono/pull/1504)).

Run it locally with:

```bash
GH_TOKEN=... OPENAI_API_KEY=... pnpm -w run flue:issue-triage --id issue-triage-local \
  --payload '{"issueNumber": 1, "repository": "getsentry/sentry-mcp"}'
```

The skill may read issue details, inspect repository files, apply existing labels, close confirmed duplicates, and post concise comments. It treats issue content as untrusted input and must not modify files, execute issue-provided commands, open pull requests, create labels, close non-duplicates, or expose secrets.
