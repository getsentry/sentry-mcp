/**
 * Local preservation check for Sentry edits. The server reads bounded pages,
 * while file-change preparation has the complete original and final contents.
 * Only source-free findings cross the workflow boundary.
 */

import { configuredFeatures } from "../detect-sentry.js";
import type { PreparedFileChange } from "./prepare.js";
import type { FileChangeFailure } from "./result.js";

const SENTRY_SETUP_CALLS_RE =
  /\b(?:(?:sentry[a-z0-9_$]*)\s*(?:\.|::|\\|_)\s*(?:configure|init|initialize|setup|start)|(?:add|configure|init|initialize|setup|start|use|with)sentry[a-z0-9_$]*)\b/gi;
const SENTRY_REFERENCE_RE =
  /\bSentry\b|@sentry\/|\bsentry_sdk\b|\bSENTRY_[A-Z0-9_]+\b/i;
const SENTRY_CONFIG_PATH_RE =
  /(?:^|\/)(?:sentry(?:\.[^/]+)?\.config\.[^/]+|sentry\.(?:properties|ya?ml)|\.sentryclirc|config\/sentry\.php)$/i;
const NON_PRODUCTION_PATH_RE =
  /(?:^|\/)(?:test|tests|__tests__|spec|specs|fixtures?|__fixtures__)(?:\/|$)|\.(?:md|mdx|rst|adoc)$|\.(?:test|spec)\.[^/]+$/i;
const DSN_ASSIGNMENT_RE = /\bdsn\b\s*(?::|=>|=)\s*([^,\n}\r]+)/gi;
const DSN_QUOTED_ASSIGNMENT_RE = /["']dsn["']\s*(?::|=>|=)\s*([^,\n}\r]+)/gi;
const DSN_SETTER_RE = /\bsetDsn\s*\(\s*([^,\n}\r]+)/gi;
const DSN_SHORTHAND_RE = /(?:^|[{,\n])\s*dsn\s*(?=[,\n}])/gim;
const SOURCE_REFERENCE_RE =
  /\b(?:[a-z_$][\w$]*\.)*(?:env|environ|getenv|config|configuration|settings|secrets?|vault)(?:(?:\s*(?:\.|::)\s*[a-z_$][\w$]*)|(?:\s*[[(]\s*["']?[^)\]\n,"']+["']?\s*[)\]]))*/gi;
const LEGACY_SOURCE_MAP_RE = /\bsourceMapsUploadOptions\s*:/i;
const MODERN_SOURCE_MAP_RE = /\bsourcemaps\s*:/i;
const SOURCE_MAP_CONFIG_RE =
  /\b(?:sourceMapsUploadOptions|sourcemaps?|source_maps?)\s*(?:\.\s*[\w$]+\s*)?:/gi;
const SOURCE_MAP_FIELD_RE =
  /\b(?:org|project|authToken|sourcemaps|assets)\s*:\s*([^,\r\n]+)/gi;
const SOURCE_MAP_ASSETS_RE = /\bassets\s*:\s*(\[[\s\S]*?\])/gi;
const SOURCE_MAP_DOTTED_SETTING_RE =
  /\bsourcemaps?\s*\.\s*[\w$]+\s*:\s*([^,\r\n]+)/gi;
const WHITESPACE_RE = /\s+/g;
const TRAILING_BRACE_RE = /\s*}+\s*$/;
const NEWLINE_RE = /\r?\n/;
const COMMENT_ONLY_LINE_RE = /^\s*(?:\/\/|#|\/\*|\*|<!--|--)/;

type Evidence = {
  dsn: string[];
  features: Map<string, number>;
  hasLegacySourceMaps: boolean;
  hasModernSourceMaps: boolean;
  sourceMapCount: number;
  setupCallCount: number;
  sourceMapAssets: string[];
  sourceMapSettings: string[];
  sourceMapFields: string[];
  sourceReferences: string[];
};

function normalizedMatches(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)]
    .flatMap((match) => (match[1]?.trim() ? [match[1].trim()] : []))
    .map((expression) => expression.replace(WHITESPACE_RE, " "));
}

function dsnExpressions(value: string): string[] {
  const expressions = [
    ...normalizedMatches(value, DSN_ASSIGNMENT_RE),
    ...normalizedMatches(value, DSN_QUOTED_ASSIGNMENT_RE),
    ...normalizedMatches(value, DSN_SETTER_RE),
  ];
  for (const _match of value.matchAll(DSN_SHORTHAND_RE)) {
    expressions.push("dsn");
  }
  return expressions;
}

function sourceReferences(value: string): string[] {
  return [...value.matchAll(SOURCE_REFERENCE_RE)]
    .flatMap((match) => (match[0]?.trim() ? [match[0].trim()] : []))
    .map((reference) => reference.replace(WHITESPACE_RE, " "));
}

function sourceMapValues(value: string): string[] {
  return normalizedMatches(value, SOURCE_MAP_FIELD_RE)
    .map((expression) => expression.replace(TRAILING_BRACE_RE, "").trim())
    .filter((expression) => expression !== "{");
}

function newEvidence(): Evidence {
  return {
    dsn: [],
    features: new Map(),
    hasLegacySourceMaps: false,
    hasModernSourceMaps: false,
    sourceMapCount: 0,
    setupCallCount: 0,
    sourceMapAssets: [],
    sourceMapSettings: [],
    sourceMapFields: [],
    sourceReferences: [],
  };
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function activeSourceMapContent(value: string): string {
  return value
    .split(NEWLINE_RE)
    .filter((line) => !COMMENT_ONLY_LINE_RE.test(line))
    .join("\n");
}

function isSentryRelated(value: string, filePath: string): boolean {
  return (
    SENTRY_CONFIG_PATH_RE.test(filePath) ||
    SENTRY_REFERENCE_RE.test(value) ||
    countMatches(value, SENTRY_SETUP_CALLS_RE) > 0 ||
    countMatches(activeSourceMapContent(value), SOURCE_MAP_CONFIG_RE) > 0 ||
    dsnExpressions(value).length > 0 ||
    configuredFeatures(value.split(NEWLINE_RE)).length > 0
  );
}

function hasConcreteSetup(value: string, filePath: string): boolean {
  const sentryReference = SENTRY_REFERENCE_RE.test(value);
  const sourceMaps = activeSourceMapContent(value);
  return (
    SENTRY_CONFIG_PATH_RE.test(filePath) ||
    countMatches(value, SENTRY_SETUP_CALLS_RE) > 0 ||
    LEGACY_SOURCE_MAP_RE.test(sourceMaps) ||
    (sentryReference &&
      (dsnExpressions(value).length > 0 ||
        MODERN_SOURCE_MAP_RE.test(sourceMaps) ||
        configuredFeatures(value.split(NEWLINE_RE)).length > 0))
  );
}

function addEvidence(evidence: Evidence, value: string): void {
  const sourceMaps = activeSourceMapContent(value);
  evidence.setupCallCount += countMatches(value, SENTRY_SETUP_CALLS_RE);
  evidence.hasLegacySourceMaps ||= LEGACY_SOURCE_MAP_RE.test(sourceMaps);
  evidence.hasModernSourceMaps ||= MODERN_SOURCE_MAP_RE.test(sourceMaps);
  evidence.sourceMapCount += countMatches(sourceMaps, SOURCE_MAP_CONFIG_RE);
  evidence.dsn.push(...dsnExpressions(value));
  evidence.sourceReferences.push(...sourceReferences(value));
  if (
    LEGACY_SOURCE_MAP_RE.test(sourceMaps) ||
    MODERN_SOURCE_MAP_RE.test(sourceMaps)
  ) {
    evidence.sourceMapFields.push(...sourceMapValues(sourceMaps));
    evidence.sourceMapAssets.push(
      ...normalizedMatches(sourceMaps, SOURCE_MAP_ASSETS_RE)
    );
  }
  evidence.sourceMapSettings.push(
    ...[...sourceMaps.matchAll(SOURCE_MAP_DOTTED_SETTING_RE)].flatMap(
      (match) => (match[0] ? [match[0].replace(WHITESPACE_RE, " ")] : [])
    )
  );
  for (const feature of configuredFeatures(value.split(NEWLINE_RE))) {
    evidence.features.set(feature, (evidence.features.get(feature) ?? 0) + 1);
  }
}

function preservesAll(
  previous: readonly string[],
  next: readonly string[]
): boolean {
  const remaining = [...next];
  return previous.every((item) => {
    const index = remaining.indexOf(item);
    if (index === -1) {
      return false;
    }
    remaining.splice(index, 1);
    return true;
  });
}

function failure(
  change: PreparedFileChange,
  reason: string
): FileChangeFailure {
  return {
    action: change.action,
    code: "existing_setup_preservation",
    message: `Cannot ${change.action} "${change.path}": ${reason}`,
    path: change.path,
  };
}

function batchFailure(
  change: PreparedFileChange,
  reason: string
): FileChangeFailure {
  return {
    action: change.action,
    code: "existing_setup_preservation",
    message: `Cannot apply Sentry file-change batch: ${reason}`,
    path: change.path,
  };
}

/** Whether replacing the full original file would discard reviewable context. */
export function replacesEntireSentryFile(
  filePath: string,
  original: string,
  edits: readonly { newString: string; oldString: string }[]
): boolean {
  return (
    original.includes("\n") &&
    isSentryRelated(original, filePath) &&
    edits.some(
      (edit) => edit.oldString === original && edit.newString !== original
    )
  );
}

function originalContent(change: PreparedFileChange): string {
  if (change.action === "modify") {
    return change.expectedContent;
  }
  if (change.action === "delete" && change.expected.kind === "file") {
    return change.expected.content.toString("utf-8");
  }
  return "";
}

function sourceMapRemovalReason(
  before: Evidence,
  after: Evidence
): string | undefined {
  if (after.sourceMapCount < before.sourceMapCount) {
    return "existing source-map configuration was removed";
  }
  if (
    before.hasLegacySourceMaps &&
    !after.hasLegacySourceMaps &&
    !after.hasModernSourceMaps
  ) {
    return "source-map upload options were removed without replacement";
  }
  if (
    before.hasLegacySourceMaps &&
    !preservesAll(before.sourceMapFields, after.sourceMapFields)
  ) {
    return "existing source-map upload values were removed";
  }
  if (!preservesAll(before.sourceMapAssets, after.sourceMapAssets)) {
    return "existing source-map assets were removed";
  }
  if (!preservesAll(before.sourceMapSettings, after.sourceMapSettings)) {
    return "existing source-map settings were changed or removed";
  }
}

function featureRemovalReason(
  before: Evidence,
  after: Evidence
): string | undefined {
  for (const [feature, count] of before.features) {
    if ((after.features.get(feature) ?? 0) < count) {
      return `existing ${feature} configuration was removed`;
    }
  }
}

function preservationReason(
  before: Evidence,
  after: Evidence
): string | undefined {
  if (after.setupCallCount < before.setupCallCount) {
    return "existing Sentry initialization was removed";
  }
  if (!preservesAll(before.dsn, after.dsn)) {
    return "existing DSN wiring was changed or removed";
  }
  if (!preservesAll(before.sourceReferences, after.sourceReferences)) {
    return "an existing environment, config, or secret source was changed or removed";
  }
  return (
    sourceMapRemovalReason(before, after) ?? featureRemovalReason(before, after)
  );
}

/** Compare complete local Sentry evidence for the entire prepared batch. */
export function existingSetupPreservationFailure(
  changes: readonly PreparedFileChange[]
): FileChangeFailure | undefined {
  const before = newEvidence();
  const after = newEvidence();
  let firstRelatedChange: PreparedFileChange | undefined;

  for (const change of changes) {
    const original = originalContent(change);
    const replacement = change.action === "delete" ? "" : change.content;
    if (change.action === "delete") {
      if (
        !NON_PRODUCTION_PATH_RE.test(change.path) &&
        hasConcreteSetup(original, change.path)
      ) {
        return failure(
          change,
          "an existing Sentry setup file cannot be deleted"
        );
      }
      continue;
    }
    if (
      !(
        isSentryRelated(original, change.path) ||
        isSentryRelated(replacement, change.path)
      )
    ) {
      continue;
    }
    firstRelatedChange ??= change;
    addEvidence(before, original);
    addEvidence(after, replacement);
  }

  if (!firstRelatedChange) {
    return;
  }
  const reason = preservationReason(before, after);
  return reason ? batchFailure(firstRelatedChange, reason) : undefined;
}
