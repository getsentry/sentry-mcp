import { existsSync } from "node:fs";
import path from "node:path";
import {
  collectGlob,
  collectGrep,
  DEFAULT_SKIP_DIRS,
  DSN_ADDITIONAL_SKIP_DIRS,
} from "../../scan/index.js";
import type { DetectSentryPayload, ToolResult } from "../types.js";
import type { InitToolDefinition } from "./types.js";

const INITIALIZATION_PATTERN = [
  String.raw`\bSentry(?:Sdk|Flutter|SDK|Android)?\.(?:init\s*(?:\(|\bdo\b)|start\s*(?:\(|\{))`,
  String.raw`\bsentry_sdk\.init\s*\(`,
  String.raw`\bsentry\.Init\s*\(`,
  String.raw`\bsentry::init\s*\(`,
  String.raw`\bsentry_init\s*\(`,
  String.raw`\\Sentry\\init\s*\(`,
  String.raw`\[SentrySDK\s+startWithConfigureOptions`,
  String.raw`\bconfig\s+:sentry\b`,
].join("|");

const SDK_REFERENCE_PATTERN = [
  String.raw`@sentry/(?:angular|astro|aws-serverless|browser|bun|capacitor|cloudflare|core|deno|electron|expo|gatsby|google-cloud-serverless|nestjs|nextjs|node|nuxt|opentelemetry|react|react-native|react-router|remix|solidstart|svelte|sveltekit|tanstackstart-react|vue|wasm)(?:["'/\s]|$)`,
  String.raw`\bsentry[-_.]?sdk\b`,
  String.raw`\bio\.sentry\b`,
  String.raw`\bsentry_flutter\b`,
  String.raw`\bsentry-ruby\b`,
  String.raw`\bsentry-go\b`,
  String.raw`\bsentry/sentry\b`,
  String.raw`\{:sentry\s*,`,
  String.raw`PackageReference[^>]+Include=["']Sentry(?:\.|["'])`,
  "getsentry/sentry-cocoa",
].join("|");

const CONFIGURED_FEATURE_MARKERS = [
  {
    feature: "performanceMonitoring",
    markers: [
      "tracesSampleRate",
      "tracesSampler",
      "traces_sample_rate",
      "traces_sampler",
      "browserTracingIntegration",
    ],
  },
  {
    feature: "sessionReplay",
    markers: [
      "replaysSessionSampleRate",
      "replaysOnErrorSampleRate",
      "replayIntegration",
      "new Sentry.Replay",
    ],
  },
  {
    feature: "profiling",
    markers: [
      "profilesSampleRate",
      "profilesSampler",
      "profileSessionSampleRate",
      "profileLifecycle",
      "profiles_sample_rate",
      "profiles_sampler",
      "profile_session_sample_rate",
      "profile_lifecycle",
      "nodeProfilingIntegration",
      "browserProfilingIntegration",
      "@sentry/profiling-node",
    ],
  },
  { feature: "logs", markers: ["enableLogs", "enable_logs"] },
  {
    feature: "aiMonitoring",
    markers: [
      "openAIIntegration",
      "vercelAIIntegration",
      "anthropicAIIntegration",
    ],
  },
  {
    feature: "mcpObservability",
    markers: ["wrapMcpServerWithSentry", "MCPIntegration"],
  },
  {
    feature: "userFeedback",
    markers: ["showReportDialog", "feedbackIntegration"],
  },
  {
    feature: "reactFeatures",
    markers: [
      "Sentry.ErrorBoundary",
      "withErrorBoundary",
      "reactErrorHandler",
      "captureReactException",
    ],
  },
] as const;

const FEATURE_SIGNAL_PATTERN = CONFIGURED_FEATURE_MARKERS.flatMap(
  ({ markers }) => markers
)
  .map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const SDK_CONFIG_PATTERNS = [
  "**/sentry.*.config.*",
  "**/sentry.config.*",
  "**/config/sentry.php",
] as const;

const AUXILIARY_CONFIG_PATTERNS = [
  "**/sentry.properties",
  "**/sentry.yml",
  "**/sentry.yaml",
] as const;

const DETECTION_EXCLUDES = [
  "**/{test,tests,__tests__,spec,specs,fixture,fixtures,__fixtures__}/**",
  "**/*.{test,spec}.*",
] as const;

const SDK_CONFIG_FILE_RE = /(?:^|\/)sentry(?:\.[^./]+)?\.config\./;
const LARAVEL_CONFIG_FILE_RE = /(?:^|\/)config\/sentry\.php$/;
const COMMENT_ONLY_LINE_RE = /^\s*(?:\/\/|#|\/\*|\*|<!--|--)/;

const SOURCE_AND_MANIFEST_PATTERNS = [
  "*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte,py,go,rb,erb,php,java,kt,kts,scala,groovy,cs,fs,vb,rs,swift,m,mm,dart,ex,exs,erl,lua,c,cc,cpp,cxx,h,hpp}",
  "package.json",
  "pyproject.toml",
  "requirements*.txt",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "*.gemspec",
  "composer.json",
  "pom.xml",
  "build.gradle*",
  "Package.swift",
  "pubspec.yaml",
  "*.csproj",
  "packages.config",
  "mix.exs",
] as const;

export type ExistingSentryStatus = "installed" | "partial" | "none";

export type ExistingSentryEvidence =
  | { kind: "initialization"; path: string }
  | { kind: "config"; path: string; sdkConfig: boolean }
  | { kind: "sdk"; path: string }
  | { kind: "dsn"; path?: string; source: string };

/** Deterministic local evidence used by the workflow and project resolver. */
export type ExistingSentryDetection = {
  status: ExistingSentryStatus;
  signals: string[];
  evidence?: ExistingSentryEvidence[];
  features?: string[];
  dsn?: string;
  evidenceTruncated?: boolean;
};

function configuredFeatures(lines: readonly string[]): string[] {
  const normalizedLines = lines.map((line) => line.toLowerCase());
  return CONFIGURED_FEATURE_MARKERS.flatMap(({ feature, markers }) =>
    markers.some((marker) =>
      normalizedLines.some((line) => line.includes(marker.toLowerCase()))
    )
      ? [feature]
      : []
  );
}

async function findConfigFiles(
  cwd: string
): Promise<{ files: string[]; truncated: boolean }> {
  const result = await collectGlob({
    cwd,
    patterns: [...SDK_CONFIG_PATTERNS, ...AUXILIARY_CONFIG_PATTERNS],
    exclude: DETECTION_EXCLUDES,
    maxResults: 50,
  });
  const files = new Set(result.files);
  if (existsSync(path.join(cwd, ".sentryclirc"))) {
    files.add(".sentryclirc");
  }
  return { files: [...files].sort(), truncated: result.truncated };
}

/**
 * Detect an existing Sentry setup without requiring a literal DSN.
 * Runtime initialization, an SDK config convention, or a DSN means installed.
 * An SDK reference or auxiliary CLI/build config by itself means partial so
 * the improvement flow can repair the application setup.
 */
export async function detectSentrySetup(
  cwd: string
): Promise<ExistingSentryDetection> {
  const { detectAllDsnOccurrences } = await import("../../dsn/index.js");
  const [
    dsnOccurrences,
    initialization,
    sdkReferences,
    featureSignals,
    configResult,
  ] = await Promise.all([
    detectAllDsnOccurrences(cwd),
    collectGrep({
      cwd,
      pattern: INITIALIZATION_PATTERN,
      include: SOURCE_AND_MANIFEST_PATTERNS,
      exclude: DETECTION_EXCLUDES,
      alwaysSkipDirs: [...DEFAULT_SKIP_DIRS, ...DSN_ADDITIONAL_SKIP_DIRS],
      maxMatchesPerFile: 1,
      maxResults: 100,
    }),
    collectGrep({
      cwd,
      pattern: SDK_REFERENCE_PATTERN,
      caseSensitive: false,
      include: SOURCE_AND_MANIFEST_PATTERNS,
      exclude: DETECTION_EXCLUDES,
      alwaysSkipDirs: [...DEFAULT_SKIP_DIRS, ...DSN_ADDITIONAL_SKIP_DIRS],
      maxResults: 20,
    }),
    collectGrep({
      cwd,
      pattern: FEATURE_SIGNAL_PATTERN,
      caseSensitive: false,
      include: SOURCE_AND_MANIFEST_PATTERNS,
      exclude: DETECTION_EXCLUDES,
      alwaysSkipDirs: [...DEFAULT_SKIP_DIRS, ...DSN_ADDITIONAL_SKIP_DIRS],
      maxMatchesPerFile: 20,
      maxResults: 200,
    }),
    findConfigFiles(cwd),
  ]);

  const dsn = dsnOccurrences[0];
  const configFiles = configResult.files;

  const runtimeInitialization = initialization.matches.filter(
    (match) => !COMMENT_ONLY_LINE_RE.test(match.line)
  );
  const rawEvidence: ExistingSentryEvidence[] = [
    ...runtimeInitialization.map(
      (match): ExistingSentryEvidence => ({
        kind: "initialization",
        path: match.path,
      })
    ),
    ...configFiles.map(
      (file): ExistingSentryEvidence => ({
        kind: "config",
        path: file,
        sdkConfig:
          SDK_CONFIG_FILE_RE.test(file) || LARAVEL_CONFIG_FILE_RE.test(file),
      })
    ),
    ...sdkReferences.matches.map(
      (match): ExistingSentryEvidence => ({ kind: "sdk", path: match.path })
    ),
    ...dsnOccurrences.map(
      (detectedDsn): ExistingSentryEvidence => ({
        kind: "dsn",
        source: detectedDsn.source,
        ...(detectedDsn.sourcePath ? { path: detectedDsn.sourcePath } : {}),
      })
    ),
  ];
  const evidenceBySignal = new Map(
    rawEvidence.map((item) => [formatEvidence(item), item])
  );
  const uniqueSignals = [...evidenceBySignal.keys()];
  const evidence = [...evidenceBySignal.values()];
  const hasSdkConfig = evidence.some(
    (item) => item.kind === "config" && item.sdkConfig
  );
  const installed =
    runtimeInitialization.length > 0 || hasSdkConfig || Boolean(dsn);
  let status: ExistingSentryStatus = "none";
  if (installed) {
    status = "installed";
  } else if (uniqueSignals.length > 0) {
    status = "partial";
  }
  const features = configuredFeatures(
    featureSignals.matches
      .filter((match) => !COMMENT_ONLY_LINE_RE.test(match.line))
      .map((match) => match.line)
  );
  if (installed) {
    features.unshift("errorMonitoring");
  }

  return {
    status,
    signals: uniqueSignals,
    evidence,
    ...(features.length > 0 ? { features } : {}),
    ...(dsn ? { dsn: dsn.raw } : {}),
    ...((initialization.stats.truncated || configResult.truncated) && {
      evidenceTruncated: true,
    }),
  };
}

/**
 * Derive the backward-compatible display signal from structured evidence.
 * Target discovery consumes `evidence` directly and must not parse this text.
 */
function formatEvidence(evidence: ExistingSentryEvidence): string {
  switch (evidence.kind) {
    case "initialization":
      return `init: ${evidence.path}`;
    case "config":
      return `config: ${evidence.path}`;
    case "sdk":
      return `sdk: ${evidence.path}`;
    case "dsn":
      return `dsn: ${evidence.source}${evidence.path ? ` (${evidence.path})` : ""}`;
    default:
      throw new Error("Unsupported Sentry evidence kind");
  }
}

/** Detect existing Sentry signals in the local project directory. */
export async function detectSentry(cwd: string): Promise<ToolResult> {
  try {
    return { ok: true, data: await detectSentrySetup(cwd) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for Sentry install detection.
 */
export const detectSentryTool: InitToolDefinition<"detect-sentry"> = {
  operation: "detect-sentry",
  describe: () => "Checking for existing Sentry setup...",
  execute: async (payload: DetectSentryPayload) =>
    await detectSentry(payload.cwd),
};
