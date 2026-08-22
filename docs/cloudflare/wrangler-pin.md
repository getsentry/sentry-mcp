# Wrangler Pin

The app CLI (`packages/mcp-cloudflare` / catalog `wrangler`) is intentionally
pinned below the latest Wrangler release.

## Current pin

- App CLI: `wrangler@4.80.0` (catalog)
- Vitest plugin may pull a newer *internal* Wrangler via
  `@cloudflare/vitest-plugin`; that path is separate from `wrangler dev` smoke.

## Why

`wrangler@4.125.0` can abort during local smoke against this Worker:

1. Early routes (`/`, `/mcp`, `/api/metadata`, …) succeed.
2. Around `/.well-known/oauth-authorization-server` the process prints an empty
   `ERROR` and exits.
3. Remaining smoke tests then fail with `ECONNRESET` / `ECONNREFUSED`.

This is a local `wrangler dev` stability issue, not a production deploy path
failure. Keep the pin until a newer Wrangler release keeps
`.github/workflows/smoke-tests.yml` green for several consecutive CI runs.

## Safe upgrade checklist

1. Bump catalog `wrangler` only (keep package.json on `catalog:`).
2. `pnpm install` and commit the lockfile.
3. `pnpm build`
4. Run local smoke exactly like CI:

   ```bash
   cd packages/mcp-cloudflare
   WRANGLER_SEND_METRICS=false CI=true pnpm exec wrangler dev --port 8788 --local
   # other terminal
   PREVIEW_URL=http://localhost:8788 pnpm --dir ../smoke-tests test:ci
   ```

5. Confirm the process stays up through OAuth metadata routes and finishes
   **14/14**.
6. Push and require the GitHub **Smoke Tests (Local)** job green before merge.
7. Do **not** pass `--ip 127.0.0.1` in CI unless that bind mode is re-validated;
   default localhost is the configuration smoke covers.

## Related

- PR investigation context: Cloudflare vitest plugin migration
- Smoke workflow: `.github/workflows/smoke-tests.yml`
