# Sources

## Source List

| Source | Use |
| --- | --- |
| User request in this session | Defines required behavior: duplicate search and closure, repository checkout, diagnosis, validation, sharpening the title when needed, and posting a short triage-bot comment instead of rewriting the issue body. |
| Flue README issue triage example | Confirms GitHub Actions + CLI-only Flue agent pattern, `sandbox: "local"`, staged skill calls, command grants, and structured Valibot results. |
| `gh issue --help`, `gh issue view --help`, `gh issue edit --help`, `gh issue close --help`, `gh search issues --help`, `gh label list --help` | Confirms available GitHub CLI commands and flags for reading issues, searching duplicates, editing bodies, closing issues, and listing labels. |
| Repository `AGENTS.md` | Supplies project workflow constraints, security expectations, and quality gate expectations. |

## Coverage Matrix

| Requirement | Covered By |
| --- | --- |
| Search for duplicate GitHub issues | `search-duplicates` stage |
| Close confirmed duplicates with a note | `close-duplicate` stage |
| Clone or prepare repository correctly | Flue handler `prepareRepository()` plus GitHub Actions checkout |
| Diagnose and validate issue concern | `diagnose-and-validate` stage |
| Sharpen unclear titles when needed | `diagnose-and-validate` (`should_update_title`) and `apply-triage-update` (title-only edit) |
| Post a triage-bot comment summarizing findings | `diagnose-and-validate` (`proposed_comment` template) and `apply-triage-update` (`gh issue comment`) |
| Never rewrite the reporter's issue body | `apply-triage-update` guards: no `--body`/`--body-file` on `gh issue edit` |
| Pass trusted issue and label context into the model | Flue handler `readIssueContext()` before each model stage |
| Avoid prompt injection from issue content | Global rules |

## Open Gaps

- The first implementation does not run an end-to-end dry run against a real issue to confirm GitHub token permissions.
- Duplicate detection is agent-assisted and conservative; it may require follow-up tuning after observing real triage outcomes.
