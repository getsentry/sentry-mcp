# MCP Server Package Refactoring Plan

**Goal**: Split `mcp-server` into two packages:
- **`mcp-core`**: Private workspace package with shared code (tools, API client, server builder)
- **`mcp-stdio`**: Published package (keeping name `@sentry/mcp-server`) that fully bundles all core code

**Status**: Planning phase - not yet implemented

---

## Key Decisions

### Package Names
- **Core**: `@sentry/mcp-core` (private, not published to npm)
- **Stdio**: `@sentry/mcp-server` (keep existing name for no breaking changes)

### Build Strategy
- **Approach**: DevDependency + Full Bundling
- **mcp-stdio**: Uses `@sentry/mcp-core` as `devDependency`, bundles everything at build time
- **mcp-cloudflare**: Uses `@sentry/mcp-core` as workspace dependency (private package, not published)
- **Publishing**: mcp-core never published, only mcp-stdio published to npm

### Test Strategy
- Tests move with their code
- CLI/stdio tests → mcp-stdio package
- Core tests stay in mcp-core package

---

## Architecture Overview

### Current State
```
packages/
├── mcp-server/           # Contains everything (tools, API, CLI, stdio transport)
├── mcp-cloudflare/       # Imports from @sentry/mcp-server
├── mcp-server-mocks/
├── mcp-server-evals/
└── mcp-test-client/
```

### Target State
```
packages/
├── mcp-core/             # Shared code (private package)
│   ├── src/
│   │   ├── api-client/   # Sentry API client
│   │   ├── tools/        # 19 MCP tools
│   │   ├── internal/     # Utilities, agents, helpers
│   │   ├── telem/        # Logging, Sentry integration
│   │   ├── utils/        # Shared utilities
│   │   ├── test-utils/   # Test helpers
│   │   ├── server.ts     # buildServer() function
│   │   ├── types.ts      # ServerContext, etc.
│   │   ├── permissions.ts
│   │   ├── skills.ts
│   │   ├── schema.ts
│   │   ├── errors.ts
│   │   ├── constants.ts
│   │   └── version.ts
│   └── scripts/          # Build scripts
│
├── mcp-stdio/            # CLI/stdio package (published)
│   ├── src/
│   │   ├── cli/          # MOVED from mcp-server
│   │   │   ├── parse.ts
│   │   │   ├── resolve.ts
│   │   │   ├── types.ts
│   │   │   └── usage.ts
│   │   ├── transports/   # MOVED from mcp-server
│   │   │   └── stdio.ts
│   │   └── index.ts      # MOVED from mcp-server (CLI entry)
│   └── package.json      # Bundles all of mcp-core
│
├── mcp-cloudflare/       # Uses workspace dep on mcp-core
├── mcp-server-mocks/
├── mcp-server-evals/
└── mcp-test-client/
```

---

## Detailed File Movement

### Files Moving to mcp-stdio
From `packages/mcp-server/src/`:

```
src/cli/parse.ts              → mcp-stdio/src/cli/parse.ts
src/cli/parse.test.ts         → mcp-stdio/src/cli/parse.test.ts
src/cli/resolve.ts            → mcp-stdio/src/cli/resolve.ts
src/cli/resolve.test.ts       → mcp-stdio/src/cli/resolve.test.ts
src/cli/types.ts              → mcp-stdio/src/cli/types.ts
src/cli/usage.ts              → mcp-stdio/src/cli/usage.ts
src/transports/stdio.ts       → mcp-stdio/src/transports/stdio.ts
src/index.ts                  → mcp-stdio/src/index.ts
```

### Files Staying in mcp-core
Everything else in `packages/mcp-server/` stays, package renamed to `mcp-core`:

```
src/api-client/               ✅ STAY - shared API client
src/tools/                    ✅ STAY - all 19 tools
src/internal/                 ✅ STAY - utilities, agents
src/telem/                    ✅ STAY - logging, Sentry
src/utils/                    ✅ STAY - shared utilities
src/test-utils/               ✅ STAY - test helpers
src/server.ts                 ✅ STAY - buildServer()
src/types.ts                  ✅ STAY - ServerContext
src/permissions.ts            ✅ STAY - shared
src/skills.ts                 ✅ STAY - shared
src/schema.ts                 ✅ STAY - shared schemas
src/errors.ts                 ✅ STAY - error classes
src/constants.ts              ✅ STAY - shared constants
src/version.ts                ✅ STAY - version info
scripts/                      ✅ STAY - build scripts
toolDefinitions.json          ✅ STAY - generated file
skillDefinitions.json         ✅ STAY - generated file
```

---

## Package Configuration

### packages/mcp-core/package.json

```json
{
  "name": "@sentry/mcp-core",
  "version": "0.22.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./dist/index.js",
    "./api-client": "./dist/api-client/index.js",
    "./api-client/client": "./dist/api-client/client.js",
    "./api-client/errors": "./dist/api-client/errors.js",
    "./api-client/schema": "./dist/api-client/schema.js",
    "./api-client/types": "./dist/api-client/types.js",
    "./server": "./dist/server.js",
    "./types": "./dist/types.js",
    "./tools": "./dist/tools/index.js",
    "./tools/types": "./dist/tools/types.js",
    "./permissions": "./dist/permissions.js",
    "./skills": "./dist/skills.js",
    "./schema": "./dist/schema.js",
    "./errors": "./dist/errors.js",
    "./constants": "./dist/constants.js",
    "./version": "./dist/version.js",
    "./telem/logging": "./dist/telem/logging.js",
    "./telem/sentry": "./dist/telem/sentry.js",
    "./toolDefinitions": "./dist/toolDefinitions.js",
    "./skillDefinitions": "./dist/skillDefinitions.js",
    "./internal/tool-helpers/api-utils": "./dist/internal/tool-helpers/api-utils.js",
    "./internal/error-handling": "./dist/internal/error-handling.js"
  },
  "files": ["./dist/*"],
  "scripts": {
    "build": "pnpm run generate-definitions && tsdown",
    "generate-definitions": "tsx scripts/generate-definitions.ts",
    "generate-otel-namespaces": "tsx scripts/generate-otel-namespaces.ts",
    "measure-tokens": "tsx scripts/measure-token-cost.ts",
    "validate-skills": "tsx scripts/validate-skills-mapping.ts"
  },
  "dependencies": {
    "@ai-sdk/openai": "catalog:",
    "@logtape/logtape": "catalog:",
    "@logtape/sentry": "catalog:",
    "@modelcontextprotocol/sdk": "catalog:",
    "@sentry/core": "catalog:",
    "ai": "catalog:",
    "dotenv": "catalog:",
    "zod": "catalog:",
    "zod-to-json-schema": "catalog:"
  },
  "devDependencies": {
    "@sentry/mcp-server-mocks": "workspace:*",
    "@sentry/mcp-server-tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**Key changes from current mcp-server:**
- Added `"private": true`
- Removed `"bin"` field (not an executable)
- Removed stdio-specific exports
- Kept all other exports intact

### packages/mcp-stdio/package.json

```json
{
  "name": "@sentry/mcp-server",
  "version": "0.22.0",
  "description": "Sentry MCP server for stdio transport",
  "type": "module",
  "bin": {
    "sentry-mcp": "./dist/index.js"
  },
  "files": ["./dist/*"],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "catalog:",
    "@sentry/node": "catalog:",
    "@sentry/core": "catalog:",
    "dotenv": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@sentry/mcp-core": "workspace:*",
    "@sentry/mcp-server-mocks": "workspace:*",
    "@sentry/mcp-server-tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**Key points:**
- Keeps existing name `@sentry/mcp-server` (no breaking changes)
- Has `bin` field for CLI execution
- **mcp-core is devDependency** (build-time only)
- Dependencies are minimal runtime-only deps
- tsdown will bundle all mcp-core code

### packages/mcp-stdio/tsdown.config.ts

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.test.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    // Only mark test-only packages as external
    "@sentry/mcp-server-mocks",
    // Everything else (including @sentry/mcp-core) will be bundled
  ],
  env: {
    SENTRY_ENVIRONMENT: "stdio",
    npm_package_version: "{{version}}"
  }
});
```

**Critical configuration:**
- **Does NOT list `@sentry/mcp-core` in `external`**
- This means tsdown will bundle all mcp-core code into dist/
- Only mocks are external (for testing purposes)

### packages/mcp-cloudflare/package.json

```json
{
  "name": "@sentry/mcp-cloudflare",
  "private": true,
  "dependencies": {
    "@sentry/mcp-core": "workspace:*"
  }
}
```

**Changes:**
- Replace `@sentry/mcp-server` → `@sentry/mcp-core`
- Package stays private, so workspace dependency is fine

---

## Import Changes

### In mcp-stdio Files

All moved files need import updates:

#### mcp-stdio/src/index.ts
```typescript
// BEFORE (relative imports)
import { buildServer } from "./server";
import { startStdio } from "./transports/stdio";
import type { ServerContext } from "./types";

// AFTER (package imports)
import { buildServer } from "@sentry/mcp-core/server";
import { startStdio } from "./transports/stdio";
import type { ServerContext } from "@sentry/mcp-core/types";
```

#### mcp-stdio/src/transports/stdio.ts
```typescript
// BEFORE
import { LIB_VERSION } from "../version";
import type { ServerContext } from "../types";

// AFTER
import { LIB_VERSION } from "@sentry/mcp-core/version";
import type { ServerContext } from "@sentry/mcp-core/types";
```

#### mcp-stdio/src/cli/resolve.ts
```typescript
// BEFORE
import { ALL_SCOPES, parseScopes, expandScopes } from "../permissions";
import { parseSkills, getScopesForSkills } from "../skills";
import { DEFAULT_SCOPES, DEFAULT_SKILLS } from "../constants";
import { UserInputError } from "../errors";

// AFTER
import { ALL_SCOPES, parseScopes, expandScopes } from "@sentry/mcp-core/permissions";
import { parseSkills, getScopesForSkills } from "@sentry/mcp-core/skills";
import { DEFAULT_SCOPES, DEFAULT_SKILLS } from "@sentry/mcp-core/constants";
import { UserInputError } from "@sentry/mcp-core/errors";
```

### In mcp-cloudflare Files

Update all imports from `@sentry/mcp-server` → `@sentry/mcp-core`:

```typescript
// BEFORE
import { buildServer } from "@sentry/mcp-server/server";
import type { ServerContext } from "@sentry/mcp-server/types";
import { parseScopes, expandScopes } from "@sentry/mcp-server/permissions";

// AFTER
import { buildServer } from "@sentry/mcp-core/server";
import type { ServerContext } from "@sentry/mcp-core/types";
import { parseScopes, expandScopes } from "@sentry/mcp-core/permissions";
```

Files to update in mcp-cloudflare:
- `src/server/index.ts`
- `src/server/auth/verify.ts`
- `src/server/routes/mcp.ts`
- `src/server/sentry.config.ts`
- Any other files importing from mcp-server

---

## Implementation Steps

### Phase 1: Rename Core Package
1. Rename directory: `packages/mcp-server/` → `packages/mcp-core/`
2. Update `package.json`:
   - Change `name` to `@sentry/mcp-core`
   - Add `"private": true`
   - Remove `bin` field
3. Remove stdio-specific exports from `exports` field
4. Test build: `cd packages/mcp-core && pnpm build`

### Phase 2: Create Stdio Package
1. Create directory: `packages/mcp-stdio/`
2. Create initial structure:
   ```bash
   mkdir -p packages/mcp-stdio/src/{cli,transports}
   ```
3. Move files from mcp-core to mcp-stdio:
   - `src/cli/*` → `mcp-stdio/src/cli/`
   - `src/transports/stdio.ts` → `mcp-stdio/src/transports/stdio.ts`
   - `src/index.ts` → `mcp-stdio/src/index.ts`
4. Create `package.json` (see config above)
5. Create `tsdown.config.ts` (see config above)
6. Create `tsconfig.json`:
   ```json
   {
     "extends": "@sentry/mcp-server-tsconfig/base.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist", "**/*.test.ts"]
   }
   ```
7. Update imports in moved files (see "Import Changes" section)
8. Test build: `cd packages/mcp-stdio && pnpm build`
9. Verify bundling worked:
   ```bash
   # Check that mcp-core code is bundled
   cat dist/index.js | grep "buildServer"
   # Should see the actual function code, not just an import
   ```

### Phase 3: Update Cloudflare Package
1. Update `packages/mcp-cloudflare/package.json`:
   - Change dependency: `"@sentry/mcp-server"` → `"@sentry/mcp-core": "workspace:*"`
2. Find and replace imports:
   ```bash
   cd packages/mcp-cloudflare
   # Find all imports
   grep -r "@sentry/mcp-server" src/
   # Replace (manually or with sed)
   find src/ -type f -name "*.ts" -exec sed -i '' 's/@sentry\/mcp-server/@sentry\/mcp-core/g' {} +
   ```
3. Test build: `cd packages/mcp-cloudflare && pnpm build`

### Phase 4: Update Other Packages
1. Update `packages/mcp-test-client/package.json`:
   - If it imports from mcp-server, update to mcp-core
2. Update `packages/mcp-server-evals/package.json`:
   - Same as above
3. Update `packages/mcp-server-mocks/package.json`:
   - Check if any changes needed

### Phase 5: Update Root Configuration
1. Update `pnpm-workspace.yaml` (if needed):
   ```yaml
   packages:
     - packages/*
   ```
2. Update `turbo.json`:
   - Ensure build dependencies are correct
   - mcp-stdio should depend on mcp-core build
3. Update root `package.json` scripts if they reference package names

### Phase 6: Update Build Pipeline
1. Verify turbo cache works:
   ```bash
   pnpm -w run build
   # Should build mcp-core first, then mcp-stdio
   ```
2. Test incremental builds:
   ```bash
   # Change a file in mcp-core
   echo "// test" >> packages/mcp-core/src/server.ts
   pnpm -w run build
   # Should rebuild both mcp-core and mcp-stdio
   ```
3. Update GitHub Actions workflows:
   - `.github/workflows/test.yml`
   - `.github/workflows/release.yml`
   - Any other workflows that reference package names

### Phase 7: Update Documentation
1. Update `CLAUDE.md`:
   - Repository map section
   - Package descriptions
2. Update `docs/architecture.mdc`:
   - Package structure
   - Dependencies diagram
3. Update `docs/releases/stdio.mdc`:
   - New package structure
   - Build process
4. Update `docs/cursor.mdc`:
   - Package references
5. Update `AGENTS.md`:
   - Package structure
6. Update `packages/mcp-core/README.md`:
   - Note it's a private package
   - Explain it's shared code
7. Update `packages/mcp-stdio/README.md`:
   - Installation instructions
   - Note it bundles core
8. Update any other docs mentioning package structure

### Phase 8: Testing & Validation
1. **Build tests**:
   ```bash
   pnpm -w run build
   # All packages should build successfully
   ```

2. **Type check**:
   ```bash
   pnpm -w run tsc
   # No type errors
   ```

3. **Lint**:
   ```bash
   pnpm -w run lint
   # No lint errors
   ```

4. **Unit tests**:
   ```bash
   pnpm -w run test
   # All tests pass
   ```

5. **Test stdio package locally**:
   ```bash
   cd packages/mcp-stdio
   node dist/index.js --help
   # Should show help text

   node dist/index.js --access-token=test-token --version
   # Should show version
   ```

6. **Test with npx simulation**:
   ```bash
   cd packages/mcp-stdio
   pnpm pack
   # Creates sentry-mcp-server-*.tgz

   npm install -g ./sentry-mcp-server-*.tgz
   sentry-mcp --help
   # Should work globally

   npm uninstall -g @sentry/mcp-server
   ```

7. **Test cloudflare package**:
   ```bash
   cd packages/mcp-cloudflare
   pnpm dev
   # Should start dev server without errors
   ```

8. **Test MCP inspector**:
   ```bash
   pnpm inspector
   # Connect to stdio server
   # Verify tools load correctly
   ```

9. **Verify no mcp-core in published package**:
   ```bash
   cd packages/mcp-stdio
   tar -tzf sentry-mcp-server-*.tgz
   # Check package.json
   tar -xzf sentry-mcp-server-*.tgz
   cat package/package.json | grep mcp-core
   # Should NOT appear in dependencies
   ```

---

## Verification Checklist

### Build Verification
- [ ] `pnpm -w run build` succeeds
- [ ] mcp-core builds first (turbo dependency)
- [ ] mcp-stdio builds after mcp-core
- [ ] mcp-cloudflare builds successfully
- [ ] All dist/ directories contain expected files

### Bundle Verification
- [ ] mcp-stdio/dist/index.js contains bundled mcp-core code
- [ ] mcp-stdio/dist/index.js does NOT import from @sentry/mcp-core
- [ ] File size is reasonable (check `ls -lh packages/mcp-stdio/dist/`)

### Package.json Verification
- [ ] mcp-core has `"private": true`
- [ ] mcp-core has no `bin` field
- [ ] mcp-stdio has `bin` field pointing to dist/index.js
- [ ] mcp-stdio has mcp-core in devDependencies only
- [ ] Packed package.json has no mcp-core reference

### Import Verification
- [ ] All mcp-stdio files import from `@sentry/mcp-core/*`
- [ ] All mcp-cloudflare files import from `@sentry/mcp-core/*`
- [ ] No relative imports crossing package boundaries

### Test Verification
- [ ] All unit tests pass
- [ ] CLI tests work in mcp-stdio package
- [ ] No broken imports in test files
- [ ] Mock imports still work

### Runtime Verification
- [ ] `node packages/mcp-stdio/dist/index.js --help` works
- [ ] `node packages/mcp-stdio/dist/index.js --version` works
- [ ] Can connect via MCP inspector
- [ ] Tools load and execute correctly
- [ ] Cloudflare dev server starts

### Documentation Verification
- [ ] All docs updated with new package names
- [ ] Installation instructions correct
- [ ] Architecture diagrams updated
- [ ] No broken doc links

---

## Rollback Plan

If issues arise during implementation:

1. **Before committing**: Simply delete mcp-stdio, rename mcp-core back to mcp-server
2. **After committing**: Revert the commit: `git revert <commit-hash>`
3. **If published**: Publish a new patch version with the old structure

---

## Expected Outcomes

### For End Users
- ✅ No breaking changes (package name stays `@sentry/mcp-server`)
- ✅ Same installation: `npx @sentry/mcp-server`
- ✅ Same CLI flags and behavior
- ✅ No knowledge of mcp-core needed

### For Developers
- ✅ Clear separation: core vs transport-specific code
- ✅ Cloudflare can depend on core directly
- ✅ Better modularity for future transports
- ✅ Type safety during development
- ✅ Turbo caching works correctly

### For the Codebase
- ✅ mcp-core is private (never published)
- ✅ mcp-stdio fully self-contained (no external core dep)
- ✅ Clean package boundaries
- ✅ Easier to maintain and extend
- ✅ Future HTTP/SSE transports can be separate packages

---

## Future Considerations

### Adding More Transports
If we want to add other transports in the future:

```
packages/
├── mcp-core/          # Shared code (private)
├── mcp-stdio/         # Stdio transport (published as @sentry/mcp-server)
├── mcp-http/          # Future: HTTP transport package
├── mcp-sse/           # Future: SSE transport package
└── mcp-cloudflare/    # Web app (uses core via workspace)
```

Each transport package would:
- Import from `@sentry/mcp-core` as devDependency
- Bundle all core code at build time
- Be published independently with its own name
- Have transport-specific configuration and entry points

---

## Notes

### Why DevDependency + Bundling?
- **Type safety**: Full IDE support during development
- **Clean publishing**: No reference to unpublished package
- **Turbo-friendly**: Explicit build dependencies
- **User-friendly**: Zero knowledge of internal packages needed

### Why Keep @sentry/mcp-server Name?
- No breaking changes for existing users
- Existing documentation remains valid
- npx commands don't need updating
- IDE configs don't need updating

### Why Not Publish mcp-core?
- It's an internal implementation detail
- No use case for external consumption
- Reduces maintenance burden (no semver, no changelog)
- Allows internal refactoring without breaking changes

---

## Questions & Answers

**Q: Why not use tsup instead of tsdown?**
A: tsdown is already used and works well. No need to change.

**Q: Should we bundle node_modules too?**
A: No, only mcp-core. External packages like MCP SDK and Sentry should remain external.

**Q: What about source maps?**
A: Enable in tsdown config for better debugging.

**Q: How to handle version bumps?**
A: Both packages should have same version. Consider using Changesets or manual sync.

**Q: What about the README?**
A: mcp-stdio keeps the user-facing README. mcp-core gets a developer-focused README.

---

## Timeline Estimate

- **Phase 1-2** (Core rename + Stdio creation): 2-3 hours
- **Phase 3-4** (Update other packages): 1 hour
- **Phase 5-6** (Build pipeline): 1 hour
- **Phase 7** (Documentation): 1-2 hours
- **Phase 8** (Testing): 2-3 hours

**Total**: ~8-12 hours of focused work

---

## Success Criteria

The refactoring is complete when:
1. ✅ `pnpm -w run build` succeeds for all packages
2. ✅ `pnpm -w run test` passes all tests
3. ✅ Can run stdio server: `node packages/mcp-stdio/dist/index.js --help`
4. ✅ Can pack and install: `npm install -g ./packages/mcp-stdio/*.tgz`
5. ✅ Cloudflare dev server works: `cd packages/mcp-cloudflare && pnpm dev`
6. ✅ No `@sentry/mcp-core` in packed mcp-stdio package.json
7. ✅ All documentation updated and accurate

---

**End of Plan**
