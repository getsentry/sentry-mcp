import {
  type ApplicationText,
  buildApplication,
  text_en,
  UnexpectedPositionalError,
  UnsatisfiedPositionalError,
} from "@stricli/core";
import { alertRoute } from "./commands/alert/index.js";
import { apiCommand } from "./commands/api.js";
import { authRoute } from "./commands/auth/index.js";
import { whoamiCommand } from "./commands/auth/whoami.js";
import { bashHookCommand } from "./commands/bash-hook.js";
import { buildRoute } from "./commands/build/index.js";
import { cliRoute } from "./commands/cli/index.js";
import { codeMappingsRoute } from "./commands/code-mappings/index.js";
import { dartSymbolMapRoute } from "./commands/dart-symbol-map/index.js";
import { dashboardRoute } from "./commands/dashboard/index.js";
import { listCommand as dashboardListCommand } from "./commands/dashboard/list.js";
import { debugFilesRoute } from "./commands/debug-files/index.js";
import { eventRoute } from "./commands/event/index.js";
import { listCommand as eventListCommand } from "./commands/event/list.js";
import { exploreCommand } from "./commands/explore.js";
import { feedbackRoute } from "./commands/feedback/index.js";
import { helpCommand } from "./commands/help.js";
import { infoCommand } from "./commands/info.js";
import { initCommand } from "./commands/init.js";
import { issueRoute } from "./commands/issue/index.js";
import { listCommand as issueListCommand } from "./commands/issue/list.js";
import { localRoute } from "./commands/local/index.js";
import { logRoute } from "./commands/log/index.js";
import { listCommand as logListCommand } from "./commands/log/list.js";
import { monitorRoute } from "./commands/monitor/index.js";
import { listCommand as monitorListCommand } from "./commands/monitor/list.js";
import { orgRoute } from "./commands/org/index.js";
import { listCommand as orgListCommand } from "./commands/org/list.js";
import { proguardRoute } from "./commands/proguard/index.js";
import { projectRoute } from "./commands/project/index.js";
import { listCommand as projectListCommand } from "./commands/project/list.js";
import { reactNativeRoute } from "./commands/react-native/index.js";
import { releaseRoute } from "./commands/release/index.js";
import { listCommand as releaseListCommand } from "./commands/release/list.js";
import { replayRoute } from "./commands/replay/index.js";
import { listCommand as replayListCommand } from "./commands/replay/list.js";
import { repoRoute } from "./commands/repo/index.js";
import { listCommand as repoListCommand } from "./commands/repo/list.js";
import { schemaCommand } from "./commands/schema.js";
import { sendEnvelopeCommand } from "./commands/send-envelope.js";
import { sendEventCommand } from "./commands/send-event.js";
import { snapshotsRoute } from "./commands/snapshots/index.js";
import { sourcemapRoute } from "./commands/sourcemap/index.js";
import { spanRoute } from "./commands/span/index.js";
import { listCommand as spanListCommand } from "./commands/span/list.js";
import { teamRoute } from "./commands/team/index.js";
import { listCommand as teamListCommand } from "./commands/team/list.js";
import { traceRoute } from "./commands/trace/index.js";
import { listCommand as traceListCommand } from "./commands/trace/list.js";
import { trialRoute } from "./commands/trial/index.js";
import { listCommand as trialListCommand } from "./commands/trial/list.js";
import {
  getCommandSuggestion,
  getSynonymSuggestionFromArgv,
} from "./lib/command-suggestions.js";
import { CLI_VERSION } from "./lib/constants.js";
import { reportCliError } from "./lib/error-reporting.js";
import {
  AuthError,
  CliError,
  getExitCode,
  OutputError,
  stringifyUnknown,
  WizardError,
} from "./lib/errors.js";
import { error as errorColor, warning } from "./lib/formatters/colors.js";
import { isRouteMap, type RouteMap } from "./lib/introspect.js";
import { buildRouteMap } from "./lib/route-map.js";

/**
 * Plural alias → singular route name mapping.
 * Used to suggest the correct command when users type e.g. `sentry projects view cli`.
 */
const PLURAL_TO_SINGULAR: Record<string, string> = {
  dashboards: "dashboard",
  events: "event",
  issues: "issue",
  orgs: "org",
  projects: "project",
  releases: "release",
  repos: "repo",
  teams: "team",
  logs: "log",
  monitors: "monitor",
  replays: "replay",

  spans: "span",
  traces: "trace",
  trials: "trial",
};

/** Top-level route map containing all CLI commands */
export const routes = buildRouteMap({
  routes: {
    help: helpCommand,
    alert: alertRoute,
    auth: authRoute,
    build: buildRoute,
    cli: cliRoute,
    "code-mappings": codeMappingsRoute,
    "dart-symbol-map": dartSymbolMapRoute,
    "debug-files": debugFilesRoute,
    dashboard: dashboardRoute,
    org: orgRoute,
    project: projectRoute,
    proguard: proguardRoute,
    "react-native": reactNativeRoute,
    replay: replayRoute,
    release: releaseRoute,
    repo: repoRoute,
    team: teamRoute,
    issue: issueRoute,
    event: eventRoute,
    events: eventListCommand,
    explore: exploreCommand,
    feedback: feedbackRoute,
    log: logRoute,
    monitor: monitorRoute,
    snapshots: snapshotsRoute,
    sourcemap: sourcemapRoute,
    sourcemaps: sourcemapRoute,
    span: spanRoute,
    trace: traceRoute,
    trial: trialRoute,
    init: initCommand,
    info: infoCommand,
    local: localRoute,
    api: apiCommand,
    schema: schemaCommand,
    // Backward-compat aliases for old sentry-cli — hidden from help
    "send-event": sendEventCommand,
    "send-envelope": sendEnvelopeCommand,
    "bash-hook": bashHookCommand,
    dashboards: dashboardListCommand,
    issues: issueListCommand,
    orgs: orgListCommand,
    projects: projectListCommand,
    replays: replayListCommand,
    releases: releaseListCommand,
    repos: repoListCommand,
    teams: teamListCommand,
    logs: logListCommand,
    monitors: monitorListCommand,
    spans: spanListCommand,
    traces: traceListCommand,
    trials: trialListCommand,
    whoami: whoamiCommand,
  },
  defaultCommand: "help",
  docs: {
    brief: "A gh-like CLI for Sentry",
    fullDescription:
      "sentry is a command-line interface for interacting with Sentry. " +
      "It provides commands for authentication, viewing issues, and making API calls.",
    hideRoute: {
      dashboards: true,
      events: true,
      issues: true,
      orgs: true,
      projects: true,
      replays: true,
      releases: true,
      repos: true,
      teams: true,
      logs: true,
      monitors: true,
      spans: true,
      traces: true,
      trials: true,
      sourcemaps: true,
      whoami: true,
      "send-event": true,
      "send-envelope": true,
      "bash-hook": true,
    },
  },
});

/**
 * Route group names that have `defaultCommand` set.
 *
 * Derived from the route map at module load time — no manual list to maintain.
 * Used to detect the no-args case (`sentry issue` with no subcommand)
 * so we can show a usage hint instead of a confusing parse error.
 */
const routesWithDefaultCommand: ReadonlySet<string> = new Set(
  routes
    .getAllEntries()
    .filter(
      (e) =>
        isRouteMap(e.target as unknown) &&
        (e.target as unknown as RouteMap).getDefaultCommand?.()
    )
    .map((e) => e.name.original)
);

/**
 * Detect when the user typed a bare route group with no subcommand (e.g., `sentry issue`).
 *
 * With `defaultCommand: "view"` on route groups, Stricli routes to the view
 * command which then fails with UnsatisfiedPositionalError because no issue ID
 * was provided. Returns a usage hint string, or undefined if this isn't the
 * bare-route-group case.
 */
function detectBareRouteGroup(ansiColor: boolean): string | undefined {
  const args = process.argv.slice(2);
  const nonFlags = args.filter((t) => !t.startsWith("-"));
  if (
    nonFlags.length <= 1 &&
    nonFlags[0] &&
    routesWithDefaultCommand.has(nonFlags[0])
  ) {
    const route = nonFlags[0];
    const msg = `Usage: sentry ${route} <command> [args]\nRun "sentry ${route} --help" to see available commands`;
    return ansiColor ? warning(msg) : msg;
  }
  return;
}

/**
 * Detect when a plural alias received extra positional args and suggest the
 * singular form. E.g., `sentry projects view cli` → `sentry project view cli`.
 */
function detectPluralAliasMisuse(ansiColor: boolean): string | undefined {
  const args = process.argv.slice(2);
  const firstArg = args[0];
  if (firstArg && firstArg in PLURAL_TO_SINGULAR) {
    const singular = PLURAL_TO_SINGULAR[firstArg];
    const rest = args.slice(1).join(" ");
    return ansiColor
      ? warning(`\nDid you mean: sentry ${singular} ${rest}\n`)
      : `\nDid you mean: sentry ${singular} ${rest}\n`;
  }
  return;
}

/**
 * Format a CliError with a synonym suggestion when the user typed a known
 * synonym that was consumed as a positional arg by `defaultCommand: "view"`.
 *
 * Returns the formatted error string if a synonym match is found,
 * undefined otherwise. Skips Sentry capture for these known user mistakes.
 */
function formatSynonymError(
  exc: unknown,
  ansiColor: boolean
): string | undefined {
  if (!(exc instanceof CliError)) {
    return;
  }
  const synonymHint = getSynonymSuggestionFromArgv();
  if (!synonymHint) {
    return;
  }
  const prefix = ansiColor ? errorColor("Error:") : "Error:";
  const tip = ansiColor
    ? warning(`Tip: ${synonymHint}`)
    : `Tip: ${synonymHint}`;
  return `${prefix} ${exc.format()}\n${tip}`;
}

/**
 * Custom error formatting for CLI errors.
 *
 * - AuthError (not_authenticated): Re-thrown to allow auto-login flow in bin.ts
 * - Other CliError subclasses: Show clean user-friendly message without stack trace
 * - Other errors: Show stack trace for debugging unexpected issues
 */
const customText: ApplicationText = {
  ...text_en,
  exceptionWhileParsingArguments: (
    exc: unknown,
    ansiColor: boolean
  ): string => {
    // Case A: bare route group with no subcommand (e.g., `sentry issue`)
    if (exc instanceof UnsatisfiedPositionalError) {
      const bareHint = detectBareRouteGroup(ansiColor);
      if (bareHint) {
        return bareHint;
      }
    }

    // Case B + plural alias: extra args that Stricli can't consume
    if (exc instanceof UnexpectedPositionalError) {
      const pluralHint = detectPluralAliasMisuse(ansiColor);
      if (pluralHint) {
        return `${text_en.exceptionWhileParsingArguments(exc, ansiColor)}${pluralHint}`;
      }

      // With defaultCommand: "view", unknown tokens like "metrics" fill the
      // positional slot, then extra args (e.g., CLI-AB) trigger this error.
      // Check if the first non-route token is a known synonym.
      const synonymHint = getSynonymSuggestionFromArgv();
      if (synonymHint) {
        const tip = ansiColor
          ? warning(`\nTip: ${synonymHint}`)
          : `\nTip: ${synonymHint}`;
        return `${text_en.exceptionWhileParsingArguments(exc, ansiColor)}${tip}`;
      }
    }

    return text_en.exceptionWhileParsingArguments(exc, ansiColor);
  },
  noCommandRegisteredForInput: ({ input, corrections, ansiColor }): string => {
    // Default error message from Stricli (e.g., "No command registered for `info`")
    const base = text_en.noCommandRegisteredForInput({
      input,
      corrections,
      ansiColor,
    });

    // Check for known synonym suggestions on routes without defaultCommand
    // (e.g., `sentry cli info` → suggest `sentry auth status`).
    // Routes WITH defaultCommand won't reach here — their unknown tokens
    // are consumed as positional args and handled by Cases A/B/C above.
    const args = process.argv.slice(2);
    const nonFlags = args.filter((t) => !t.startsWith("-"));
    const routeContext = nonFlags[0] ?? "";
    const suggestion = getCommandSuggestion(routeContext, input);
    if (suggestion) {
      const hint = suggestion.explanation
        ? `${suggestion.explanation}: ${suggestion.command}`
        : suggestion.command;
      // Stricli wraps our return value in bold-red ANSI codes.
      // Reset before applying warning() color so the tip is yellow, not red.
      const formatted = ansiColor
        ? `\n\x1B[39m\x1B[22m${warning(`Tip: ${hint}`)}`
        : `\nTip: ${hint}`;
      return `${base}${formatted}`;
    }

    return base;
  },
  exceptionWhileRunningCommand: (exc: unknown, ansiColor: boolean): string => {
    // OutputError: data was already rendered to stdout — just re-throw
    // so the exit code propagates without Stricli printing an error message.
    if (exc instanceof OutputError) {
      throw exc;
    }

    // Re-throw AuthError for auto-login flow in bin.ts
    // Don't capture to Sentry - it's an expected state (user not logged in or token expired), not an error
    // Note: skipAutoAuth is checked in bin.ts, not here — all auth errors must escape Sentry capture
    if (
      exc instanceof AuthError &&
      (exc.reason === "not_authenticated" || exc.reason === "expired")
    ) {
      throw exc;
    }

    // Case C: With defaultCommand: "view", unknown tokens like "metrics" are
    // silently consumed as the positional arg. The view command fails at the
    // domain level (e.g., ResolutionError). Check argv for a known synonym
    // and show the suggestion — skip Sentry capture since these are known
    // user mistakes, not real errors.
    const synonymResult = formatSynonymError(exc, ansiColor);
    if (synonymResult) {
      return synonymResult;
    }

    // Report command errors to Sentry with stable fingerprinting. Stricli
    // catches exceptions and doesn't re-throw, so we must capture here to
    // get visibility into command failures. Silencing rules (OutputError,
    // expected AuthError, 401–499 ApiError) and fingerprint normalization
    // are enforced inside reportCliError. 400 Bad Request = CLI bug.
    reportCliError(exc);

    if (exc instanceof CliError) {
      // WizardError with rendered=true: clack already displayed the error.
      // Return empty string to avoid double output, exit code flows through.
      if (exc instanceof WizardError && exc.rendered) {
        return "";
      }
      const prefix = ansiColor ? errorColor("Error:") : "Error:";
      return `${prefix} ${exc.format()}`;
    }
    if (exc instanceof Error) {
      return `Unexpected error: ${exc.stack ?? exc.message}`;
    }
    return `Unexpected error: ${stringifyUnknown(exc)}`;
  },
};

export const app = buildApplication(routes, {
  name: "sentry",
  versionInfo: {
    currentVersion: CLI_VERSION,
  },
  scanner: {
    caseStyle: "allow-kebab-for-camel",
    // Allow `--` to stop flag parsing so wrapper commands (e.g.
    // `sentry monitor run <slug> -- <command>`) can pass through flags
    // like `-e` or `--verbose` to the wrapped command unambiguously.
    allowArgumentEscapeSequence: true,
  },
  determineExitCode: getExitCode,
  localization: {
    loadText: () => customText,
  },
});
