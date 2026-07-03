## 1. API Client Support

- [ ] 1.1 Re-verify project creation, project details update, project teams, project team details, and project keys endpoint contracts against `~/src/sentry`.
- [ ] 1.2 Extend `createProject` to accept and send optional `slug`.
- [ ] 1.3 Add or update API client methods for listing a project's teams and removing a team from a project.
- [ ] 1.4 Adjust API client return schemas/types only as needed, preserving strict parsing and avoiding `any`.

## 2. Project Tool Changes

- [ ] 2.1 Update `create_project` schema and description to remove repository linking and add optional `slug`.
- [ ] 2.2 Change `create_project` DSN handling to list existing keys first, return an existing default/active DSN when available, and create a `Default` key only when no key exists.
- [ ] 2.3 Update `create_project` output and tests so the response always includes project identity and `SENTRY_DSN`.
- [ ] 2.4 Update `update_project` schema and description to remove `teamSlug`.
- [ ] 2.5 Add `update_project` validation requiring at least one metadata field.
- [ ] 2.6 Add `update_project` validation rejecting slug updates in project-scoped sessions.

## 3. Team Access Tools

- [ ] 3.1 Add `add_team_to_project` as a catalog-only `project-management` tool.
- [ ] 3.2 Implement `add_team_to_project` as idempotent from the user perspective by returning current teams when the team is already assigned.
- [ ] 3.3 Add `remove_team_from_project` as a catalog-only `project-management` tool with destructive safety annotation.
- [ ] 3.4 Implement `remove_team_from_project` preflight checks for team-not-assigned and last-team removal before calling DELETE.
- [ ] 3.5 Register the new tools in the catalog and confirm they are not added to the direct top-level surface.

## 4. Constraint and Availability Behavior

- [ ] 4.1 Hide or reject `create_project` in project-scoped sessions.
- [ ] 4.2 Verify organization constraints are injected for project-management tools and explicit conflicting org inputs are filtered.
- [ ] 4.3 Verify project constraints are injected for `update_project`, `add_team_to_project`, and `remove_team_from_project`.
- [ ] 4.4 Add tests for project-scoped slug update rejection.

## 5. Tests

- [ ] 5.1 Update `create-project.test.ts` snapshots for the narrowed schema and DSN-first behavior.
- [ ] 5.2 Add `create_project` tests for existing default DSN, fallback DSN creation, optional slug, and no repository linking.
- [ ] 5.3 Update `update-project.test.ts` snapshots and remove team assignment cases.
- [ ] 5.4 Add `add-team-to-project.test.ts` coverage for add, already-assigned no-op, mixed-case slug preservation, and constraint injection.
- [ ] 5.5 Add `remove-team-from-project.test.ts` coverage for remove, not assigned, last team guard, mixed-case slug preservation, and constraint injection.
- [ ] 5.6 Update registry, tool count, skill gating, and generated-definition tests as needed.

## 6. Documentation and Generated Definitions

- [ ] 6.1 Add `docs/specs/project-management.md` covering the durable project-management contract.
- [ ] 6.2 Link the new spec from `docs/specs/README.md`.
- [ ] 6.3 Update any docs that mention `update_project` team assignment or `create_project` repository linking.
- [ ] 6.4 Run `pnpm run --filter @sentry/mcp-core generate-definitions` after tool changes.

## 7. Verification

- [ ] 7.1 Run targeted unit tests for project-management tools and catalog availability.
- [ ] 7.2 Run `pnpm run tsc`.
- [ ] 7.3 Run `pnpm run lint`.
- [ ] 7.4 Run `pnpm run test`.
- [ ] 7.5 Run `pnpm run measure-tokens` if generated tool definitions materially change the catalog text size.
