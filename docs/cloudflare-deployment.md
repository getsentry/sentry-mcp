# Cloudflare deployment journal

GitHub Actions is the only production deployment and recovery authority. The
Cloudflare journal uses a protected Git branch for records and HMAC-authenticated
commit statuses for an external append-only transition ledger. Repository
rulesets remain a live write precondition, but they are never historical proof.

## Production environment setup

Create these values in the GitHub `production` environment, which must allow
deployments only from `main`:

- `CLOUDFLARE_JOURNAL_APP_ID` secret: the GitHub App ID used by the journal
  writer.
- `CLOUDFLARE_JOURNAL_APP_PRIVATE_KEY` secret: the App private key.
- `CLOUDFLARE_JOURNAL_HMAC_KEY` secret: exactly 32 random bytes encoded as 64
  lowercase hexadecimal characters. Generate it locally with
  `openssl rand -hex 32`. Never print or store this value in repository files.
- `CLOUDFLARE_JOURNAL_TRUSTED_SHA` environment variable: the full lowercase
  40-character SHA of the reviewed `main` commit that contains the bootstrap
  workflow and journal implementation.

The GitHub App installation needs repository administration read, Actions read,
commit statuses write, and contents write permissions. Keep the existing exact
ruleset pair: only this App may create or update
`cloudflare-deployment-journal`, while no actor may delete it, force-push it, or
write nonlinear history.

The workflows pass the HMAC key only to the journal store process. Reconciliation
scripts remove it from their environment before invoking GitHub CLI, Wrangler,
Cloudflare commands, or other child processes.

## First bootstrap

Bootstrap always starts from an absent journal branch. Never create the branch
by hand.

1. Merge the reviewed journal implementation into `main`.
2. Set `CLOUDFLARE_JOURNAL_TRUSTED_SHA` to that exact commit SHA.
3. Let `Deploy to Cloudflare` run and fail at the pre-mutation journal gate.
   Record its run ID and attempt.
4. Run `Bootstrap Cloudflare Deployment Journal` from `main`. Supply that failed
   deploy run ID and attempt.
5. Confirm the workflow reports an initialized store. The bootstrap command
   refuses any run that is not the failed deployment at the current default
   branch head, any failure after the mutation gate, an existing branch, or a
   trusted SHA mismatch.
6. Rerun the normal test and deployment flow. Never run the bootstrap workflow
   again for this journal namespace.

The bootstrap writes a `prepared` status on the trusted commit, creates the
branch at the exact candidate commit, then writes the matching `committed`
status. A lost response leaves enough durable state for the next store command
to settle the transition without creating another journal commit.

## Anchor protocol

Every bootstrap, journal append, reconciliation claim, and reconciliation
completion follows one protocol:

1. Build and fully validate an exact one-parent candidate commit.
2. Write a unique `prepared` commit status on the configured trusted SHA.
3. Create or advance the journal ref without force from the recorded previous
   head to the exact candidate.
4. Write the matching `committed` status.

The status context identifies the sequence and phase. Its target URL identifies
the exact candidate commit and contains the canonical anchor record. Its
description contains an HMAC-SHA-256 over that canonical record. The record
binds the repository, writer App ID, trusted SHA, sequence, phase, transition,
previous head, next head, immutable record path, and record blob SHA.

Readers ignore unrelated statuses and statuses with an invalid MAC. They reject
every malformed authenticated status, duplicate phase, gap, conflict,
committed-without-prepare record, noncontiguous head, wrong ref head, and invalid
interior transition. Validation replays every authenticated commit from the
fixed trusted root. It never accepts a tip because rulesets currently look
correct.

## Interrupted operations and recovery

At most one final `prepared` record may lack `committed`:

- If the ref still names the recorded previous head, the next journal command
  advances it to the already validated candidate and writes `committed`.
- If the ref already names the candidate, the next command writes only
  `committed`.
- For bootstrap, an absent ref is the expected previous state and the next
  command creates it at the candidate.
- Any other ref value, missing ref after a committed transition, duplicate or
  conflicting status, invalid candidate, or changed ruleset fails closed. The
  store never retries blindly, rebases, creates a second journal commit, or
  rewrites the branch.

After a failed deployment, the recovery workflow reads only the newest fully
authenticated journal. Cloudflare restoration still requires an exact live
snapshot owned by that journal. External or ambiguous Cloudflare state is never
overwritten.

## Bounds and capacity

The journal accepts at most 1,024 authenticated branch transitions. Each
transition uses two statuses, so a full valid journal uses 2,048 authenticated
statuses. A reader scans at most 4,096 statuses on the trusted commit, including
unrelated or invalid entries. It fails closed when pagination cannot prove the
list complete within that bound.

Capacity checks reserve all commits needed to finish a deployment and its
reconciliation before the workflow mutates Cloudflare. When either bound is
near exhaustion, stop production deployment and migrate through a separately
reviewed journal version. Never delete old statuses or branch commits to make
space.

## HMAC key rotation

The HMAC key authenticates the complete history, not only new writes. Never
replace it as routine secret rotation: removing the old key makes every earlier
anchor unverifiable, while retaining a suspected key cannot restore trust.

If policy requires a new cryptoperiod, first ship a reviewed journal protocol
version that supports an explicit, authenticated key transition and preserves
verification of old epochs. If the key may be compromised, stop deployment and
recovery immediately. Treat the existing ledger as unavailable and migrate to
a new trusted root and journal namespace through a security-reviewed change.
Never re-bootstrap, delete the branch, rewrite statuses, or merely replace the
secret in place.

## Failure handling

All journal commands fail before mutation when the trusted SHA, HMAC key,
rulesets, status ledger, candidate history, branch head, workflow provenance,
or capacity is invalid. Error output redacts both GitHub tokens and the HMAC
key. Do not bypass a failed check. Preserve the branch, statuses, workflow run,
and Cloudflare state for investigation.
