# Sources

## Source List

| Source | Use |
| --- | --- |
| User request in this session | Defines required behavior: duplicate search and closure, repository checkout, diagnosis, validation, concise issue rewrites, and a friendly bot comment when the issue body changes. |
| Flue README issue triage example | Confirms GitHub Actions + CLI-only Flue agent pattern, `sandbox: "local"`, staged skill calls, command grants, and structured Valibot results. |
| `gh issue --help`, `gh issue view --help`, `gh issue edit --help`, `gh issue close --help`, `gh search issues --help`, `gh label list --help` | Confirms available GitHub CLI commands and flags for reading issues, searching duplicates, editing bodies, closing issues, and listing labels. |
| Repository `AGENTS.md` | Supplies project workflow constraints, security expectations, and quality gate expectations. |

## Coverage Matrix

| Requirement | Covered By |
| --- | --- |
| Search for duplicate GitHub issues | `search-duplicates` stage |
| Close confirmed duplicates with a note | Flue handler deterministic duplicate close path |
| Clone or prepare repository correctly | Flue handler `prepareRepository()` plus GitHub Actions checkout |
| Diagnose and validate issue concern | `diagnose-and-validate` stage |
| Rewrite unclear issues in a concise format | `diagnose-and-validate` proposed title/body plus handler-applied update |
| Post a friendly comment when the body changes | `diagnose-and-validate` `update_comment` plus handler `postComment()` after `body_updated` |
| Pass trusted issue and label context into the model | Flue handler `readIssueContext()` before each model stage |
| Avoid prompt injection from issue content | Global rules |

## Open Gaps

- The first implementation does not run an end-to-end dry run against a real issue to confirm GitHub token permissions.
- Duplicate detection is agent-assisted and conservative; it may require follow-up tuning after observing real triage outcomes.
