import { UserInputError } from "../errors";
import type {
  ExternalIssue,
  IssueIntegration,
  IssueIntegrationLinkConfig,
  NativeExternalIssue,
  SentryAppInstallation,
} from "../api-client/types";

type NativeProvider = "jira" | "github" | "gitlab" | "bitbucket" | "vsts";
type AppProvider = "linear" | "shortcut";

type ParsedNativeIssueUrl = {
  kind: "native";
  provider: NativeProvider;
  url: string;
  host: string;
  domainPath?: string;
  issueId: string;
  repo?: string;
  project?: string;
};

type ParsedAppIssueUrl = {
  kind: "sentryApp";
  provider: AppProvider;
  url: string;
  host: string;
  appSlug: string;
  project: string;
  identifier: string;
};

export type ParsedExternalIssueUrl = ParsedNativeIssueUrl | ParsedAppIssueUrl;

type LinkConfigField = IssueIntegrationLinkConfig["linkIssueConfig"][number];

export type NativeExternalIssueLinkTarget = {
  kind: "native";
  integration: IssueIntegration;
  config: IssueIntegrationLinkConfig;
  payload: Record<string, unknown>;
  parsed: ParsedNativeIssueUrl;
};

export type SentryAppExternalIssueLinkTarget = {
  kind: "sentryApp";
  installation: SentryAppInstallation;
  payload: {
    webUrl: string;
    project: string;
    identifier: string;
  };
  parsed: ParsedAppIssueUrl;
};

export type ExternalIssueLinkTarget =
  | NativeExternalIssueLinkTarget
  | SentryAppExternalIssueLinkTarget;

export type LinkedExternalIssue =
  | { kind: "native"; issue: NativeExternalIssue; provider: string }
  | { kind: "sentryApp"; issue: ExternalIssue; provider: string };

export type ExternalIssueLinkApi = {
  listIssueIntegrations(params: {
    organizationSlug: string;
    issueId: string;
  }): Promise<IssueIntegration[]>;
  getIssueIntegrationLinkConfig(params: {
    organizationSlug: string;
    issueId: string;
    integrationId: string;
  }): Promise<IssueIntegrationLinkConfig>;
  listSentryAppInstallations(params: {
    organizationSlug: string;
  }): Promise<SentryAppInstallation[]>;
};

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "");
}

function normalizeUrlHost(url: URL): string {
  return normalizeHost(url.host);
}

function normalizeDomain(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const withoutProtocol = value.replace(/^https?:\/\//i, "");
  const withoutWww = withoutProtocol.replace(/^www\./i, "");
  return trimSlashes(withoutWww).toLowerCase();
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

function parseIssueNumber(value: string): string | null {
  return /^\d+$/.test(value) ? value : null;
}

function parseJiraUrl(url: URL): ParsedNativeIssueUrl | null {
  const segments = pathSegments(url);
  const browseIndex = segments.findIndex((segment) => segment === "browse");
  const issueId = browseIndex >= 0 ? segments[browseIndex + 1] : undefined;
  if (!issueId || !/^[A-Z][A-Z0-9]+-\d+$/i.test(issueId)) {
    return null;
  }
  return {
    kind: "native",
    provider: "jira",
    url: url.toString(),
    host: normalizeUrlHost(url),
    domainPath: normalizeUrlHost(url),
    issueId,
  };
}

function parseGithubUrl(url: URL): ParsedNativeIssueUrl | null {
  const host = normalizeUrlHost(url);
  if (host === "bitbucket.org" || host === "gitlab.com") {
    return null;
  }
  const segments = pathSegments(url);
  if (segments.length < 4 || segments[2] !== "issues") {
    return null;
  }
  const issueId = parseIssueNumber(segments[3] ?? "");
  if (!issueId) {
    return null;
  }
  const repo = `${segments[0]}/${segments[1]}`;
  return {
    kind: "native",
    provider: "github",
    url: url.toString(),
    host,
    domainPath: `${host}/${segments[0]}`,
    repo,
    issueId,
  };
}

function parseGitlabUrl(url: URL): ParsedNativeIssueUrl | null {
  const segments = pathSegments(url);
  const markerIndex = segments.findIndex((segment) => segment === "-");
  if (
    markerIndex < 1 ||
    segments[markerIndex + 1] !== "issues" ||
    !segments[markerIndex + 2]
  ) {
    return null;
  }
  const issueId = parseIssueNumber(segments[markerIndex + 2]);
  if (!issueId) {
    return null;
  }
  const project = segments.slice(0, markerIndex).join("/");
  return {
    kind: "native",
    provider: "gitlab",
    url: url.toString(),
    host: normalizeUrlHost(url),
    domainPath: `${normalizeUrlHost(url)}/${project}`,
    project,
    issueId,
  };
}

function parseBitbucketUrl(url: URL): ParsedNativeIssueUrl | null {
  const host = normalizeUrlHost(url);
  if (host !== "bitbucket.org") {
    return null;
  }
  const segments = pathSegments(url);
  if (segments.length < 4 || segments[2] !== "issues") {
    return null;
  }
  const issueId = parseIssueNumber(segments[3] ?? "");
  if (!issueId) {
    return null;
  }
  const repo = `${segments[0]}/${segments[1]}`;
  return {
    kind: "native",
    provider: "bitbucket",
    url: url.toString(),
    host,
    domainPath: `${host}/${segments[0]}`,
    repo,
    issueId,
  };
}

function parseVstsUrl(url: URL): ParsedNativeIssueUrl | null {
  const segments = pathSegments(url);
  const editIndex = segments.findIndex((segment) => segment === "edit");
  if (
    editIndex < 1 ||
    segments[editIndex - 1] !== "_workitems" ||
    !segments[editIndex + 1]
  ) {
    return null;
  }
  const issueId = parseIssueNumber(segments[editIndex + 1]);
  if (!issueId) {
    return null;
  }
  const host = normalizeUrlHost(url);
  const domainPath =
    normalizeHost(url.hostname) === "dev.azure.com" && segments[0]
      ? `${host}/${segments[0]}`
      : host;
  return {
    kind: "native",
    provider: "vsts",
    url: url.toString(),
    host,
    domainPath,
    issueId,
  };
}

function parseLinearUrl(url: URL): ParsedAppIssueUrl | null {
  if (normalizeHost(url.hostname) !== "linear.app") {
    return null;
  }
  const segments = pathSegments(url);
  const issueIndex = segments.findIndex((segment) => segment === "issue");
  const identifier = issueIndex >= 0 ? segments[issueIndex + 1] : undefined;
  if (!identifier) {
    return null;
  }
  const project = identifier.split("-")[0] || "linear";
  return {
    kind: "sentryApp",
    provider: "linear",
    appSlug: "linear",
    url: url.toString(),
    host: normalizeHost(url.hostname),
    project,
    identifier,
  };
}

function parseShortcutUrl(url: URL): ParsedAppIssueUrl | null {
  const host = normalizeHost(url.hostname);
  if (host !== "app.shortcut.com" && host !== "shortcut.com") {
    return null;
  }
  const segments = pathSegments(url);
  const storyIndex = segments.findIndex((segment) => segment === "story");
  const identifier = storyIndex >= 0 ? segments[storyIndex + 1] : undefined;
  if (!identifier) {
    return null;
  }
  return {
    kind: "sentryApp",
    provider: "shortcut",
    appSlug: "shortcut",
    url: url.toString(),
    host,
    project: "shortcut",
    identifier,
  };
}

export function parseExternalIssueUrl(
  externalIssueUrl: string,
): ParsedExternalIssueUrl {
  let url: URL;
  try {
    url = new URL(externalIssueUrl);
  } catch {
    throw new UserInputError("`externalIssueUrl` must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserInputError(
      "`externalIssueUrl` must use the http or https protocol.",
    );
  }

  const host = normalizeHost(url.hostname);

  const nativeParsers: Array<() => ParsedNativeIssueUrl | null> = [
    parseJiraUrl.bind(null, url),
    parseGithubUrl.bind(null, url),
    parseGitlabUrl.bind(null, url),
    parseBitbucketUrl.bind(null, url),
    parseVstsUrl.bind(null, url),
  ];
  for (const parse of nativeParsers) {
    const parsed = parse();
    if (parsed) {
      return parsed;
    }
  }

  const appParsers: Array<() => ParsedAppIssueUrl | null> = [
    parseLinearUrl.bind(null, url),
    parseShortcutUrl.bind(null, url),
  ];
  for (const parse of appParsers) {
    const parsed = parse();
    if (parsed) {
      return parsed;
    }
  }

  throw new UserInputError(
    `Unsupported external issue URL host \`${host}\`. Provide a supported Jira, GitHub, GitLab, Bitbucket, Azure DevOps, Linear, or Shortcut issue URL.`,
  );
}

function providerKeys(provider: NativeProvider): string[] {
  switch (provider) {
    case "github":
      return ["github", "github_enterprise"];
    case "jira":
      return ["jira", "jira_server"];
    case "vsts":
      return ["vsts"];
    default:
      return [provider];
  }
}

function integrationProviderKey(integration: IssueIntegration): string {
  return integration.provider.key.toLowerCase();
}

function domainMatchScore(
  integration: IssueIntegration,
  parsed: ParsedNativeIssueUrl,
): number {
  const domain = normalizeDomain(integration.domainName);
  if (!domain || !parsed.domainPath) {
    return 0;
  }
  const parsedDomain = normalizeDomain(parsed.domainPath);
  if (!parsedDomain) {
    return 0;
  }
  if (parsedDomain === domain || parsedDomain.startsWith(`${domain}/`)) {
    return domain.length;
  }
  return 0;
}

function hasChoice(field: LinkConfigField, value: string): boolean {
  if (!field.choices || field.choices.length === 0) {
    return true;
  }
  return field.choices.some(([choiceValue]) => choiceValue === value);
}

function fieldByName(
  config: IssueIntegrationLinkConfig,
  name: string,
): LinkConfigField | undefined {
  return config.linkIssueConfig.find((field) => field.name === name);
}

function configMatchesParsedUrl(
  config: IssueIntegrationLinkConfig,
  parsed: ParsedNativeIssueUrl,
): boolean {
  if (parsed.repo) {
    const repoField = fieldByName(config, "repo");
    if (repoField && !hasChoice(repoField, parsed.repo)) {
      return false;
    }
  }
  if (parsed.project) {
    const projectField = fieldByName(config, "project");
    if (projectField && !hasChoice(projectField, parsed.project)) {
      return false;
    }
  }
  return true;
}

function describeNativeCandidates(candidates: IssueIntegration[]): string {
  return candidates
    .map(
      (candidate) =>
        `${candidate.name} (${candidate.provider.key}${candidate.domainName ? `, ${candidate.domainName}` : ""})`,
    )
    .join(", ");
}

function buildNativeLinkPayload(
  parsed: ParsedNativeIssueUrl,
  config: IssueIntegrationLinkConfig,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of config.linkIssueConfig) {
    if (field.default !== undefined && field.default !== "") {
      payload[field.name] = field.default;
    }
  }

  switch (parsed.provider) {
    case "jira":
    case "vsts":
      payload.externalIssue = parsed.issueId;
      break;
    case "github":
    case "bitbucket":
      payload.repo = parsed.repo;
      payload.externalIssue = parsed.issueId;
      break;
    case "gitlab":
      payload.project = parsed.project;
      payload.externalIssue = `${parsed.project}#${parsed.issueId}`;
      break;
  }

  const missingFields = config.linkIssueConfig
    .filter((field) => field.required)
    .filter((field) => {
      const value = payload[field.name];
      return value === undefined || value === null || value === "";
    })
    .map((field) => field.name);

  if (missingFields.length > 0) {
    throw new UserInputError(
      `Unsupported external issue URL for ${config.provider.name ?? config.provider.key}. Missing required link fields: ${missingFields.join(", ")}.`,
    );
  }

  return payload;
}

async function resolveNativeTarget(params: {
  apiService: ExternalIssueLinkApi;
  organizationSlug: string;
  issueId: string;
  parsed: ParsedNativeIssueUrl;
}): Promise<NativeExternalIssueLinkTarget> {
  const { apiService, organizationSlug, issueId, parsed } = params;
  const integrations = await apiService.listIssueIntegrations({
    organizationSlug,
    issueId,
  });
  let candidates = integrations.filter((integration) =>
    providerKeys(parsed.provider).includes(integrationProviderKey(integration)),
  );

  if (candidates.length === 0) {
    throw new UserInputError(
      `No installed ${parsed.provider} issue integration can link ${parsed.url}.`,
    );
  }

  const bestDomainScore = Math.max(
    0,
    ...candidates.map((candidate) => domainMatchScore(candidate, parsed)),
  );

  // For non-public GitHub hosts (GitHub Enterprise), require a positive domain
  // match so that arbitrary URLs with GitHub-shaped paths cannot silently link
  // to a null-domain GitHub integration.
  if (
    parsed.provider === "github" &&
    parsed.host !== "github.com" &&
    bestDomainScore === 0
  ) {
    throw new UserInputError(
      `Unsupported GitHub Enterprise URL host \`${parsed.host}\`. Configure a GitHub Enterprise integration with a matching domain name before linking this URL.`,
    );
  }

  if (bestDomainScore > 0) {
    candidates = candidates.filter(
      (candidate) => domainMatchScore(candidate, parsed) === bestDomainScore,
    );
  }

  const candidatesWithConfig = await Promise.all(
    candidates.map(async (integration) => {
      const config = await apiService.getIssueIntegrationLinkConfig({
        organizationSlug,
        issueId,
        integrationId: String(integration.id),
      });
      return { integration, config };
    }),
  );
  const matchingCandidates = candidatesWithConfig.filter(({ config }) =>
    configMatchesParsedUrl(config, parsed),
  );

  if (matchingCandidates.length === 0) {
    throw new UserInputError(
      `No installed ${parsed.provider} issue integration can access the project or repository in ${parsed.url}.`,
    );
  }
  if (matchingCandidates.length > 1) {
    throw new UserInputError(
      `Multiple installed integrations can link ${parsed.url}: ${describeNativeCandidates(matchingCandidates.map(({ integration }) => integration))}. Unlink duplicate integration access in Sentry or use a URL that maps to a single installed integration.`,
    );
  }

  const [{ integration, config }] = matchingCandidates;
  return {
    kind: "native",
    integration,
    config,
    parsed,
    payload: buildNativeLinkPayload(parsed, config),
  };
}

function describeSentryAppCandidates(
  candidates: SentryAppInstallation[],
): string {
  return candidates.map((candidate) => candidate.app.slug).join(", ");
}

async function resolveSentryAppTarget(params: {
  apiService: ExternalIssueLinkApi;
  organizationSlug: string;
  parsed: ParsedAppIssueUrl;
}): Promise<SentryAppExternalIssueLinkTarget> {
  const { apiService, organizationSlug, parsed } = params;
  const appSlug = parsed.appSlug;
  const installations = await apiService.listSentryAppInstallations({
    organizationSlug,
  });
  const candidates = installations.filter(
    (installation) =>
      installation.status?.toLowerCase() !== "pending" &&
      installation.app.slug.toLowerCase() === appSlug,
  );

  if (candidates.length === 0) {
    throw new UserInputError(
      `No installed Sentry App with slug \`${appSlug}\` can link ${parsed.url}.`,
    );
  }
  if (candidates.length > 1) {
    throw new UserInputError(
      `Multiple installed Sentry Apps match ${parsed.url}: ${describeSentryAppCandidates(candidates)}.`,
    );
  }

  return {
    kind: "sentryApp",
    installation: candidates[0],
    parsed,
    payload: {
      webUrl: parsed.url,
      project: parsed.project,
      identifier: parsed.identifier,
    },
  };
}

export async function resolveExternalIssueLinkTarget(params: {
  apiService: ExternalIssueLinkApi;
  organizationSlug: string;
  issueId: string;
  externalIssueUrl: string;
}): Promise<ExternalIssueLinkTarget> {
  const parsed = parseExternalIssueUrl(params.externalIssueUrl);

  if (parsed.kind === "native") {
    return resolveNativeTarget({
      apiService: params.apiService,
      organizationSlug: params.organizationSlug,
      issueId: params.issueId,
      parsed,
    });
  }

  return resolveSentryAppTarget({
    apiService: params.apiService,
    organizationSlug: params.organizationSlug,
    parsed,
  });
}

export function formatLinkedExternalIssue(linked: LinkedExternalIssue): string {
  if (linked.kind === "sentryApp") {
    return `${linked.issue.displayName || linked.issue.issueId} (${linked.issue.serviceType || linked.provider}) → ${linked.issue.webUrl}`;
  }
  const displayName = linked.issue.displayName || linked.issue.key;
  const url = linked.issue.url ? ` → ${linked.issue.url}` : "";
  return `${displayName} (${linked.provider})${url}`;
}
