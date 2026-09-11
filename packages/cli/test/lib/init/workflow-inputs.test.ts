import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DirEntry } from "../../../src/lib/init/types.js";
import {
  precomputeSentrySetupTargets,
  precomputeWorkspaceTargetInventory,
} from "../../../src/lib/init/workflow-inputs.js";

const temporaryDirectories: string[] = [];

async function makeProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "sentry-init-targets-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        async (directory) =>
          await rm(directory, { recursive: true, force: true })
      )
  );
});

describe("precomputeSentrySetupTargets", () => {
  test("uses a non-empty identifier for a setup at the repository root", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "root-application" })
    );
    await writeFile(
      path.join(directory, "instrumentation.ts"),
      "Sentry.init({ dsn: process.env.SENTRY_DSN });"
    );

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([
      { autoSelect: true, name: ".", path: directory },
    ]);
  });

  test("maps a runtime initialization signal to its nearest workspace package", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "workspace-root" })
    );
    await mkdir(path.join(directory, "packages", "junior", "src"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "packages", "junior", "package.json"),
      JSON.stringify({
        name: "@sentry/junior",
        dependencies: { "@sentry/node": "^10.0.0" },
      })
    );
    await writeFile(
      path.join(directory, "packages", "junior", "src", "instrumentation.ts"),
      "Sentry.init({ dsn: process.env.SENTRY_DSN });"
    );

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([
      {
        autoSelect: true,
        name: "packages/junior",
        path: path.join(directory, "packages", "junior"),
      },
    ]);
  });

  test("does not promote packages that only use the @sentry organization scope", async () => {
    const directory = await makeProject();
    await mkdir(path.join(directory, "packages", "docs"), { recursive: true });
    await writeFile(
      path.join(directory, "packages", "docs", "package.json"),
      JSON.stringify({
        name: "@sentry/junior-docs",
        dependencies: { "@sentry/starlight-theme": "^1.0.0" },
      })
    );

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([]);
  });

  test("uses a non-JavaScript manifest as the nearest project boundary", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "workspace-root" })
    );
    await mkdir(path.join(directory, "apps", "api", "src"), {
      recursive: true,
    });
    await writeFile(path.join(directory, "apps", "api", "setup.py"), "");
    await writeFile(
      path.join(directory, "apps", "api", "src", "main.py"),
      "sentry_sdk.init(dsn=os.environ['SENTRY_DSN'])"
    );

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([
      {
        autoSelect: true,
        name: "apps/api",
        path: path.join(directory, "apps", "api"),
      },
    ]);
  });

  test.each([
    ["requirements-prod.txt", "main.py", "sentry_sdk.init()"],
    ["deno.json", "main.ts", "Sentry.init({})"],
    ["app.rockspec", "main.lua", "Sentry.init({})"],
  ])("recognizes %s as an application boundary", async (manifest, sourceFile, source) => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "workspace-root" })
    );
    const appDir = path.join(directory, "apps", "worker");
    await mkdir(appDir, { recursive: true });
    await writeFile(path.join(appDir, manifest), "");
    await writeFile(path.join(appDir, sourceFile), source);

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([
      { autoSelect: true, name: "apps/worker", path: appDir },
    ]);
  });

  test("keeps multiple detected setups ambiguous", async () => {
    const directory = await makeProject();
    for (const name of ["api", "web"]) {
      await mkdir(path.join(directory, "apps", name, "src"), {
        recursive: true,
      });
      await writeFile(
        path.join(directory, "apps", name, "package.json"),
        JSON.stringify({ name })
      );
      await writeFile(
        path.join(directory, "apps", name, "src", "instrumentation.ts"),
        "Sentry.init({ dsn: process.env.SENTRY_DSN });"
      );
    }

    const targets = await precomputeSentrySetupTargets(directory);

    expect(targets.map((target) => target.name)).toEqual([
      "apps/api",
      "apps/web",
    ]);
    expect(targets.every((target) => target.autoSelect)).toBe(true);
  });

  test("maps every DSN-only workspace instead of only the primary DSN", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "workspace-root" })
    );
    const fixtures = [
      ["api", "https://abc@o1.ingest.sentry.io/41"],
      ["web", "https://def@o2.ingest.sentry.io/42"],
    ] as const;
    for (const [name, dsn] of fixtures) {
      const appDir = path.join(directory, "apps", name);
      await mkdir(appDir, { recursive: true });
      await writeFile(
        path.join(appDir, "package.json"),
        JSON.stringify({ name })
      );
      await writeFile(path.join(appDir, ".env"), `SENTRY_DSN=${dsn}\n`);
    }

    const targets = await precomputeSentrySetupTargets(directory);

    expect(targets.map((target) => target.name)).toEqual([
      "apps/api",
      "apps/web",
    ]);
  });

  test("keeps separate sources when workspaces share the same DSN", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "workspace-root" })
    );
    const dsn = "https://abc@o1.ingest.sentry.io/42";
    for (const name of ["api", "web"]) {
      const appDir = path.join(directory, "apps", name);
      await mkdir(appDir, { recursive: true });
      await writeFile(
        path.join(appDir, "package.json"),
        JSON.stringify({ name })
      );
      await writeFile(path.join(appDir, ".env"), `SENTRY_DSN=${dsn}\n`);
    }

    const targets = await precomputeSentrySetupTargets(directory);

    expect(targets.map((target) => target.name)).toEqual([
      "apps/api",
      "apps/web",
    ]);
  });

  test("disables automatic selection when strong evidence is truncated", async () => {
    const directory = await makeProject();
    const appDir = path.join(directory, "apps", "api");
    await mkdir(path.join(appDir, "src"), { recursive: true });
    await writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({ name: "api" })
    );
    await Promise.all(
      Array.from(
        { length: 101 },
        async (_, index) =>
          await writeFile(
            path.join(appDir, "src", `instrumentation-${index}.ts`),
            "Sentry.init({ dsn: process.env.SENTRY_DSN });"
          )
      )
    );

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([
      { autoSelect: false, name: "apps/api", path: appDir },
    ]);
  });

  test("does not follow package manifests outside the workspace", async () => {
    const directory = await makeProject();
    const external = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "workspace-root" })
    );
    await writeFile(
      path.join(external, "package.json"),
      JSON.stringify({ name: "external-secret-name" })
    );
    const appDir = path.join(directory, "packages", "app");
    await mkdir(path.join(appDir, "src"), { recursive: true });
    await symlink(
      path.join(external, "package.json"),
      path.join(appDir, "package.json")
    );
    await writeFile(
      path.join(appDir, "src", "instrumentation.ts"),
      "Sentry.init({ dsn: process.env.SENTRY_DSN });"
    );

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([
      { autoSelect: true, name: ".", path: directory },
    ]);
  });

  test("rejects a package directory symlinked outside the workspace", async () => {
    const directory = await makeProject();
    const external = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "workspace-root" })
    );
    await writeFile(
      path.join(external, "package.json"),
      JSON.stringify({ name: "external-secret-name" })
    );
    await writeFile(
      path.join(external, ".env"),
      "SENTRY_DSN=https://abc@o1.ingest.sentry.io/42\n"
    );
    await mkdir(path.join(directory, "packages"), { recursive: true });
    await symlink(external, path.join(directory, "packages", "external"));

    await expect(precomputeSentrySetupTargets(directory)).resolves.toEqual([]);
  });
});

describe("precomputeWorkspaceTargetInventory", () => {
  test("inventories Junior's runtime, documentation site, and reference app", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "junior-monorepo" })
    );
    await writeFile(
      path.join(directory, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n  - "packages/*"\n'
    );

    const exampleDir = path.join(directory, "apps", "example");
    const docsDir = path.join(directory, "packages", "docs");
    const runtimeDir = path.join(directory, "packages", "junior");
    const dashboardDir = path.join(directory, "packages", "junior-dashboard");
    await Promise.all(
      [exampleDir, docsDir, runtimeDir, dashboardDir].map(
        async (target) => await mkdir(target, { recursive: true })
      )
    );
    await writeFile(
      path.join(exampleDir, "package.json"),
      JSON.stringify({
        name: "@sentry/junior-example",
        devDependencies: { nitro: "3.0.0" },
      })
    );
    await writeFile(
      path.join(exampleDir, "README.md"),
      "This app is the canonical Junior consumer app and test bed."
    );
    await writeFile(path.join(exampleDir, "nitro.config.ts"), "");
    await writeFile(
      path.join(docsDir, "package.json"),
      JSON.stringify({
        name: "@sentry/junior-docs",
        dependencies: { astro: "6.0.0", "@astrojs/starlight": "0.39.0" },
      })
    );
    await writeFile(path.join(docsDir, "astro.config.mjs"), "");
    await writeFile(
      path.join(runtimeDir, "package.json"),
      JSON.stringify({
        name: "@sentry/junior",
        exports: { ".": "./dist/index.js" },
      })
    );
    await writeFile(
      path.join(dashboardDir, "package.json"),
      JSON.stringify({
        name: "@sentry/junior-dashboard",
        exports: { ".": "./dist/index.js" },
      })
    );

    const listing = [
      "pnpm-workspace.yaml",
      "apps/example/package.json",
      "apps/example/README.md",
      "apps/example/nitro.config.ts",
      "packages/docs/package.json",
      "packages/docs/astro.config.mjs",
      "packages/junior/package.json",
      "packages/junior-dashboard/package.json",
    ].map(
      (filePath): DirEntry => ({
        name: path.basename(filePath),
        path: filePath,
        type: "file",
      })
    );

    await expect(
      precomputeWorkspaceTargetInventory(directory, listing, [
        { autoSelect: true, name: "junior", path: runtimeDir },
      ])
    ).resolves.toEqual({
      complete: true,
      targets: [
        {
          framework: "Nitro",
          label: "Junior Example",
          name: "apps/example",
          path: exampleDir,
          role: "example",
        },
        {
          framework: "Astro",
          label: "Junior Docs",
          name: "packages/docs",
          path: docsDir,
          role: "documentation",
        },
        {
          label: "Junior",
          name: "packages/junior",
          path: runtimeDir,
          role: "runtime",
        },
      ],
    });
  });

  test("uses README context to recognize a reference application", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "junior-monorepo" })
    );
    const consumerDir = path.join(directory, "apps", "consumer");
    await mkdir(consumerDir, { recursive: true });
    await writeFile(
      path.join(consumerDir, "package.json"),
      JSON.stringify({
        name: "@sentry/junior-consumer",
        devDependencies: { nitro: "3.0.0" },
      })
    );
    await writeFile(
      path.join(consumerDir, "README.md"),
      "Use this as the canonical consumer app and end-to-end test bed."
    );
    await writeFile(path.join(consumerDir, "nitro.config.ts"), "");

    const listing: DirEntry[] = [
      {
        name: "package.json",
        path: "apps/consumer/package.json",
        type: "file",
      },
      {
        name: "README.md",
        path: "apps/consumer/README.md",
        type: "file",
      },
      {
        name: "nitro.config.ts",
        path: "apps/consumer/nitro.config.ts",
        type: "file",
      },
    ];

    await expect(
      precomputeWorkspaceTargetInventory(directory, listing, [])
    ).resolves.toEqual({
      complete: false,
      targets: [
        {
          framework: "Nitro",
          label: "Junior Consumer",
          name: "apps/consumer",
          path: consumerDir,
          role: "example",
        },
      ],
    });
  });

  test("does not classify every Astro application as documentation", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "company-workspace" })
    );
    const websiteDir = path.join(directory, "apps", "website");
    await mkdir(websiteDir, { recursive: true });
    await writeFile(
      path.join(websiteDir, "package.json"),
      JSON.stringify({
        name: "@company/website",
        dependencies: { astro: "6.0.0" },
        scripts: { deploy: "astro build" },
      })
    );
    await writeFile(path.join(websiteDir, "astro.config.mjs"), "");

    const listing = [
      "apps/website/package.json",
      "apps/website/astro.config.mjs",
    ].map(
      (filePath): DirEntry => ({
        name: path.basename(filePath),
        path: filePath,
        type: "file",
      })
    );

    await expect(
      precomputeWorkspaceTargetInventory(directory, listing, [])
    ).resolves.toEqual({
      complete: false,
      targets: [
        {
          framework: "Astro",
          label: "Company Website",
          name: "apps/website",
          path: websiteDir,
          role: "application",
        },
      ],
    });
  });

  test("marks a partial JavaScript inventory incomplete in a mixed-language workspace", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "mixed-workspace" })
    );
    await writeFile(
      path.join(directory, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n'
    );
    const webDir = path.join(directory, "apps", "web");
    const workerDir = path.join(directory, "crates", "worker");
    await Promise.all([
      mkdir(webDir, { recursive: true }),
      mkdir(workerDir, { recursive: true }),
    ]);
    await writeFile(
      path.join(webDir, "package.json"),
      JSON.stringify({ name: "web" })
    );
    await writeFile(path.join(webDir, "next.config.ts"), "");
    await writeFile(
      path.join(workerDir, "Cargo.toml"),
      '[package]\nname = "worker"\nversion = "0.1.0"\n'
    );

    const listing = [
      "pnpm-workspace.yaml",
      "apps/web/package.json",
      "apps/web/next.config.ts",
      "crates/worker/Cargo.toml",
    ].map(
      (filePath): DirEntry => ({
        name: path.basename(filePath),
        path: filePath,
        type: "file",
      })
    );

    await expect(
      precomputeWorkspaceTargetInventory(directory, listing, [])
    ).resolves.toEqual({
      complete: false,
      targets: [
        {
          framework: "Next.js",
          label: "Mixed Web",
          name: "apps/web",
          path: webDir,
          role: "application",
        },
      ],
    });
  });
});
