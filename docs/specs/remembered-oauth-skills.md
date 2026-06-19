# Remembered OAuth Skill Defaults

## Overview

Remote OAuth consent should remember the skills a browser previously selected
for a Dynamic Client Registration client and use them as checkbox defaults on
future authorization prompts.

The remembered value is a signed browser cookie. It affects only the consent UI
defaults; submitted skills still flow through signed OAuth state and are
validated during the callback before becoming `grantedSkills`.

## Motivation

Users frequently re-authorize the same MCP client after token expiry, local
client resets, or auth cache cleanup. Remembering prior selections reduces
repeated consent work without changing the authorization model. When a client
has no remembered preference, the approval screen starts with all active
approvable skills selected.

## Design

Add a separate signed cookie:

```typescript
const COOKIE_NAME = "mcp-skill-preferences";

type SkillPreferenceCookie = {
  clients: Array<[clientId: string, skills: string[]]>;
};
```

The cookie is separate from `mcp-approved-clients`, which continues to prove the
client was approved before `/oauth/callback` completes authorization.

### LRU Retention

The cookie stores a tiny LRU list with newest entries at the end.

```typescript
const MAX_SKILL_PREFERENCE_CLIENTS = 10;

const nextClients = existing.clients.filter(([id]) => id !== clientId);
nextClients.push([clientId, filteredSkills]);
const trimmedClients = nextClients.slice(-MAX_SKILL_PREFERENCE_CLIENTS);
```

This keeps the payload bounded while supporting normal DCR churn. No timestamps
or server-side storage are required.

### Validation

On read and write:

- Ignore malformed or unsigned cookies.
- Require `clients` to be an array.
- Require client IDs to be strings.
- Filter skills to active approvable skill IDs.
- Drop entries with no valid skills.
- Ignore deprecated skills.

Invalid cookie data must not block authorization. It only falls back to the
all-active-skills approval default.

## Interface

Extend consent rendering with remembered defaults:

```typescript
interface ApprovalDialogOptions {
  // existing fields omitted
  defaultSkills?: string[];
}
```

Checkbox selection order:

1. Use remembered skills for the current `clientId`, when present.
2. Otherwise select all active approvable skills.

## OAuth Flow

### GET `/oauth/authorize`

After `lookupClient(clientId)`, read `mcp-skill-preferences` from the request
cookie and pass the matching client's skills to `renderApprovalDialog`.

### POST `/oauth/authorize`

After parsing and filtering submitted `skill` values:

1. Update `mcp-approved-clients` as today.
2. Update `mcp-skill-preferences` for the current `clientId`.
3. Append both `Set-Cookie` headers.
4. Embed the submitted skills into signed OAuth state for the upstream Sentry
   OAuth redirect.

### GET `/oauth/callback`

No behavioral change. The callback parses `oauthReqInfo.skills` from signed
state, validates with `parseSkills`, rejects empty valid skill sets, derives
Sentry API scopes, and stores `grantedSkills` in OAuth token props.

## Security Requirements

- The preference cookie is not an authorization source.
- Remembered skills must never skip the approval form.
- The callback must continue to reject empty or invalid submitted skills.
- Cookie contents must be HMAC-signed with `COOKIE_SECRET`.
- Cookie attributes should match the existing approval cookie:
  `HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=31536000`.
- Do not store Sentry user IDs, tokens, scopes, redirect URIs, or secrets in the
  preference cookie.

## Implementation

Primary files:

- `packages/mcp-cloudflare/src/server/lib/approval-dialog.ts`
- `packages/mcp-cloudflare/src/server/oauth/routes/authorize.ts`
- `packages/mcp-cloudflare/src/server/lib/approval-dialog.test.ts`
- `packages/mcp-cloudflare/src/server/oauth/authorize.test.ts`

Implementation steps:

1. Add signed cookie helpers for `mcp-skill-preferences`.
2. Add `defaultSkills?: string[]` to `ApprovalDialogOptions`.
3. Render checkboxes from remembered defaults when provided.
4. Read remembered defaults in GET `/oauth/authorize`.
5. Write the preference cookie in POST `/oauth/authorize`.
6. Preserve both approval and preference `Set-Cookie` headers.

## Testing

Add focused unit tests for:

- No preference cookie falls back to all active approvable skills.
- Remembered skills pre-check the approval form.
- Unknown, malformed, and deprecated skills are ignored.
- POST writes both cookies.
- LRU retention trims to 10 clients.
- Saving an existing client moves it to the newest position.
- A different `clientId` does not inherit remembered skills.

## Migration

No migration is required. Existing users without the preference cookie see all
active approvable skills selected. Existing `mcp-approved-clients` cookies
remain valid and unchanged.

## Future Work

If the OAuth flow later learns the Sentry user before rendering consent, the
preference key could become `(userId, clientId)`. That is intentionally out of
scope for this cookie-only design.
