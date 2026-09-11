/** Tests for deterministic existing-Sentry detection used by init. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { detectSentrySetup } from "../../../../src/lib/init/tools/detect-sentry.js";

const temporaryDirectories: string[] = [];

async function makeProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "sentry-init-detect-"));
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

describe("detectSentrySetup", () => {
  test("detects an environment-backed Node setup without a literal DSN", async () => {
    const directory = await makeProject();
    await mkdir(path.join(directory, "src"));
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "@sentry/node": "^10.0.0" } })
    );
    await writeFile(
      path.join(directory, "src/instrumentation.ts"),
      'import * as Sentry from "@sentry/node";\nSentry.init({ dsn: process.env.SENTRY_DSN });\n'
    );

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("installed");
    expect(result.signals).toContain("init: src/instrumentation.ts");
    expect(result.features).toEqual(["errorMonitoring"]);
  });

  test("reports features configured by an existing setup", async () => {
    const directory = await makeProject();
    await mkdir(path.join(directory, "src"));
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: {
          "@sentry/node": "^10.0.0",
          "@sentry/profiling-node": "^10.0.0",
        },
      })
    );
    await writeFile(
      path.join(directory, "src/instrumentation.ts"),
      [
        'import * as Sentry from "@sentry/node";',
        "Sentry.init({",
        "  enableLogs: true,",
        "  tracesSampleRate: 0.2,",
        '  profileLifecycle: "trace",',
        "  profileSessionSampleRate: 0.1,",
        "});",
      ].join("\n")
    );

    const result = await detectSentrySetup(directory);

    expect(result.features).toEqual([
      "errorMonitoring",
      "performanceMonitoring",
      "profiling",
      "logs",
    ]);
  });

  test("does not infer features from commented examples", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "sentry.server.config.ts"),
      "// enableLogs: true\nexport const setup = true;\n"
    );

    const result = await detectSentrySetup(directory);

    expect(result.features).toEqual(["errorMonitoring"]);
  });

  test("classifies an SDK dependency without initialization as partial", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "@sentry/node": "^10.0.0" } })
    );

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("partial");
    expect(result.signals).toContain("sdk: package.json");
  });

  test.each([
    "@sentry/react-router",
    "@sentry/tanstackstart-react",
  ])("recognizes the official %s SDK", async (sdkPackage) => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { [sdkPackage]: "^10.0.0" } })
    );

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("partial");
    expect(result.signals).toContain("sdk: package.json");
  });

  test("does not confuse unrelated @sentry scoped packages with SDKs", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: {
          "@sentry/junior": "workspace:*",
          "@sentry/starlight-theme": "^1.0.0",
        },
      })
    );

    await expect(detectSentrySetup(directory)).resolves.toEqual({
      evidence: [],
      status: "none",
      signals: [],
    });
  });

  test("treats a Sentry config file as an installed setup", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "sentry.server.config.ts"),
      "export const tracesSampleRate = 1;\n"
    );

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("installed");
    expect(result.signals).toContain("config: sentry.server.config.ts");
  });

  test.each([
    ["src/main.rs", "let _guard = sentry::init((dsn, options));"],
    ["src/index.php", String.raw`\Sentry\init(["dsn" => $dsn]);`],
    ["Sources/App.swift", "SentrySDK.start { options in }"],
    ["app/src/Main.kt", "SentryAndroid.init(context) { options -> }"],
    ["lib/app.rb", "Sentry.init do |config|\nend"],
    ["src/main.cpp", "sentry_init(&options);"],
  ])("detects runtime initialization in %s", async (relativePath, source) => {
    const directory = await makeProject();
    await mkdir(path.dirname(path.join(directory, relativePath)), {
      recursive: true,
    });
    await writeFile(path.join(directory, relativePath), source);

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("installed");
    expect(result.signals).toContain(`init: ${relativePath}`);
  });

  test("classifies auxiliary Sentry CLI config alone as partial", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "sentry.properties"),
      "defaults.org=acme"
    );

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("partial");
    expect(result.signals).toContain("config: sentry.properties");
  });

  test.each([
    [
      "composer.json",
      JSON.stringify({ require: { "sentry/sentry-laravel": "^4.0" } }),
    ],
    ["mix.exs", 'defp deps, do: [{:sentry, "~> 11.0"}]'],
  ])("detects a framework-managed SDK dependency in %s", async (file, source) => {
    const directory = await makeProject();
    await writeFile(path.join(directory, file), source);

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("partial");
    expect(result.signals).toContain(`sdk: ${file}`);
  });

  test.each([
    ["config/sentry.php", "<?php return ['dsn' => env('SENTRY_LARAVEL_DSN')];"],
    ["config/runtime.exs", 'config :sentry, dsn: System.get_env("SENTRY_DSN")'],
  ])("detects framework-managed Sentry configuration in %s", async (file, source) => {
    const directory = await makeProject();
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), source);

    const result = await detectSentrySetup(directory);

    expect(result.status).toBe("installed");
  });

  test("does not treat test fixtures as an installed application setup", async () => {
    const directory = await makeProject();
    await mkdir(path.join(directory, "tests", "fixtures"), { recursive: true });
    await writeFile(
      path.join(directory, "tests", "fixtures", "setup.ts"),
      "Sentry.init({ dsn: 'example' });"
    );

    await expect(detectSentrySetup(directory)).resolves.toEqual({
      evidence: [],
      status: "none",
      signals: [],
    });
  });

  test("does not treat commented initialization examples as installed", async () => {
    const directory = await makeProject();
    await mkdir(path.join(directory, "src"));
    await writeFile(
      path.join(directory, "src", "example.ts"),
      "// Sentry.init({ dsn: 'example' });"
    );

    await expect(detectSentrySetup(directory)).resolves.toEqual({
      evidence: [],
      status: "none",
      signals: [],
    });
  });

  test("returns none for a project with no Sentry evidence", async () => {
    const directory = await makeProject();
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0" } })
    );

    await expect(detectSentrySetup(directory)).resolves.toEqual({
      evidence: [],
      status: "none",
      signals: [],
    });
  });
});
