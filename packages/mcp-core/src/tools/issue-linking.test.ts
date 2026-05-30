import { describe, expect, it } from "vitest";
import { UserInputError } from "../errors";
import {
  parseExternalIssueUrl,
  resolveExternalIssueLinkTarget,
} from "./issue-linking";
import type {
  IssueIntegration,
  IssueIntegrationLinkConfig,
  SentryAppInstallation,
} from "../api-client/types";

function integration(
  overrides: Partial<IssueIntegration> = {},
): IssueIntegration {
  return {
    id: "1",
    name: "GitHub",
    domainName: "github.com/getsentry",
    provider: { key: "github", slug: "github", name: "GitHub" },
    externalIssues: [],
    ...overrides,
  };
}

function linkConfig(
  overrides: Partial<IssueIntegrationLinkConfig> = {},
): IssueIntegrationLinkConfig {
  return {
    id: "1",
    name: "GitHub",
    domainName: "github.com/getsentry",
    provider: { key: "github", slug: "github", name: "GitHub" },
    linkIssueConfig: [
      {
        name: "repo",
        required: true,
        choices: [["getsentry/sentry", "getsentry/sentry"]],
      },
      { name: "externalIssue", required: true },
      { name: "comment", required: false, default: "Sentry Issue" },
    ],
    ...overrides,
  };
}

function installation(
  overrides: Partial<SentryAppInstallation> = {},
): SentryAppInstallation {
  return {
    uuid: "linear-installation",
    status: "installed",
    app: { slug: "linear", uuid: "linear-app", sentryAppId: 1 },
    ...overrides,
  };
}

describe("parseExternalIssueUrl", () => {
  it("parses supported native provider URLs", () => {
    expect(
      parseExternalIssueUrl("https://acme.atlassian.net/browse/ENG-123"),
    ).toMatchObject({
      kind: "native",
      provider: "jira",
      issueId: "ENG-123",
    });
    expect(
      parseExternalIssueUrl("https://jira.example.org:8443/browse/OPS-456"),
    ).toMatchObject({
      kind: "native",
      provider: "jira",
      host: "jira.example.org:8443",
      domainPath: "jira.example.org:8443",
      issueId: "OPS-456",
    });
    expect(
      parseExternalIssueUrl("https://github.com/getsentry/sentry/issues/123"),
    ).toMatchObject({
      kind: "native",
      provider: "github",
      repo: "getsentry/sentry",
      issueId: "123",
    });
    expect(
      parseExternalIssueUrl(
        "https://gitlab.com/getsentry/backend/service/-/issues/456",
      ),
    ).toMatchObject({
      kind: "native",
      provider: "gitlab",
      project: "getsentry/backend/service",
      issueId: "456",
    });
    expect(
      parseExternalIssueUrl(
        "https://bitbucket.org/getsentry/sentry/issues/789/test",
      ),
    ).toMatchObject({
      kind: "native",
      provider: "bitbucket",
      repo: "getsentry/sentry",
      issueId: "789",
    });
    expect(
      parseExternalIssueUrl(
        "https://dev.azure.com/acme/project/_workitems/edit/42",
      ),
    ).toMatchObject({
      kind: "native",
      provider: "vsts",
      issueId: "42",
    });
  });

  it("parses supported Sentry App provider URLs", () => {
    expect(
      parseExternalIssueUrl("https://linear.app/acme/issue/ENG-123/test"),
    ).toMatchObject({
      kind: "sentryApp",
      appSlug: "linear",
      project: "ENG",
      identifier: "ENG-123",
    });
    expect(
      parseExternalIssueUrl("https://app.shortcut.com/acme/story/123/test"),
    ).toMatchObject({
      kind: "sentryApp",
      appSlug: "shortcut",
      project: "shortcut",
      identifier: "123",
    });
  });

  it("rejects unsupported URLs", () => {
    expect(() =>
      parseExternalIssueUrl("https://tickets.example.com/work/ABC-1"),
    ).toThrow(UserInputError);
    // GitLab URL missing the /-/ marker must not fall through to the Bitbucket parser
    expect(() =>
      parseExternalIssueUrl("https://gitlab.com/getsentry/sentry/issues/123"),
    ).toThrow(UserInputError);
  });
});

describe("resolveExternalIssueLinkTarget", () => {
  it("resolves native integrations and builds payloads independently", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [
          integration({ id: "1", domainName: "github.com/getsentry" }),
        ],
        getIssueIntegrationLinkConfig: async () => linkConfig({ id: "1" }),
        listSentryAppInstallations: async () => [],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
    });

    expect(target).toMatchObject({
      kind: "native",
      integration: { id: "1" },
      payload: {
        repo: "getsentry/sentry",
        externalIssue: "123",
        comment: "Sentry Issue",
      },
    });
  });

  it("uses longest domain match for nested GitLab groups", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [
          integration({
            id: "1",
            name: "GitLab Root",
            domainName: "gitlab.com/getsentry",
            provider: { key: "gitlab" },
          }),
          integration({
            id: "2",
            name: "GitLab Backend",
            domainName: "gitlab.com/getsentry/backend",
            provider: { key: "gitlab" },
          }),
        ],
        getIssueIntegrationLinkConfig: async ({ integrationId }) =>
          linkConfig({
            id: integrationId,
            provider: { key: "gitlab" },
            linkIssueConfig: [
              {
                name: "project",
                required: true,
                choices: [
                  ["getsentry/backend/service", "getsentry/backend/service"],
                ],
              },
              { name: "externalIssue", required: true },
            ],
          }),
        listSentryAppInstallations: async () => [],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl:
        "https://gitlab.com/getsentry/backend/service/-/issues/123",
    });

    expect(target).toMatchObject({
      kind: "native",
      integration: { id: "2" },
      payload: {
        project: "getsentry/backend/service",
        externalIssue: "getsentry/backend/service#123",
      },
    });
  });

  it("normalizes www-prefixed integration domains for matching", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [
          integration({ id: "1", name: "GitHub Other", domainName: null }),
          integration({
            id: "2",
            name: "GitHub Getsentry",
            domainName: "www.github.com/getsentry",
          }),
        ],
        getIssueIntegrationLinkConfig: async ({ integrationId }) =>
          linkConfig({ id: integrationId }),
        listSentryAppInstallations: async () => [],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
    });

    expect(target).toMatchObject({
      kind: "native",
      integration: { id: "2" },
    });
  });

  it("resolves self-hosted Jira Server integrations by domain", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [
          integration({
            id: "1",
            name: "Jira Cloud",
            domainName: "acme.atlassian.net",
            provider: { key: "jira" },
          }),
          integration({
            id: "2",
            name: "Example Jira",
            domainName: "jira.example.org:8443",
            provider: { key: "jira_server" },
          }),
        ],
        getIssueIntegrationLinkConfig: async ({ integrationId }) =>
          linkConfig({
            id: integrationId,
            provider: { key: "jira_server" },
            linkIssueConfig: [{ name: "externalIssue", required: true }],
          }),
        listSentryAppInstallations: async () => [],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl: "https://jira.example.org:8443/browse/OPS-456",
    });

    expect(target).toMatchObject({
      kind: "native",
      integration: { id: "2" },
      payload: {
        externalIssue: "OPS-456",
      },
    });
  });

  it("uses the Azure DevOps organization segment for domain matching", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [
          integration({
            id: "1",
            name: "Azure Other",
            domainName: "dev.azure.com/other",
            provider: { key: "vsts" },
          }),
          integration({
            id: "2",
            name: "Azure Acme",
            domainName: "dev.azure.com/acme",
            provider: { key: "vsts" },
          }),
        ],
        getIssueIntegrationLinkConfig: async ({ integrationId }) =>
          linkConfig({
            id: integrationId,
            provider: { key: "vsts" },
            linkIssueConfig: [{ name: "externalIssue", required: true }],
          }),
        listSentryAppInstallations: async () => [],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl: "https://dev.azure.com/acme/project/_workitems/edit/42",
    });

    expect(target).toMatchObject({
      kind: "native",
      integration: { id: "2" },
      payload: {
        externalIssue: "42",
      },
    });
  });

  it("rejects non-github.com hosts with no matching GitHub Enterprise integration domain", async () => {
    await expect(
      resolveExternalIssueLinkTarget({
        apiService: {
          listIssueIntegrations: async () => [
            integration({ id: "1", domainName: null }),
          ],
          getIssueIntegrationLinkConfig: async () => linkConfig({ id: "1" }),
          listSentryAppInstallations: async () => [],
        },
        organizationSlug: "sentry",
        issueId: "PROJ-1",
        externalIssueUrl:
          "https://internal.company.com/getsentry/sentry/issues/123",
      }),
    ).rejects.toThrow(
      /Configure a GitHub Enterprise integration with a matching domain/,
    );
  });

  it("resolves GitHub Enterprise URLs with a configured integration domain", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [
          integration({
            id: "1",
            name: "GitHub Enterprise",
            domainName: "internal.company.com/getsentry",
            provider: { key: "github_enterprise" },
          }),
        ],
        getIssueIntegrationLinkConfig: async () =>
          linkConfig({
            id: "1",
            provider: { key: "github_enterprise" },
          }),
        listSentryAppInstallations: async () => [],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl:
        "https://internal.company.com/getsentry/sentry/issues/123",
    });

    expect(target).toMatchObject({
      kind: "native",
      integration: { id: "1" },
      payload: {
        repo: "getsentry/sentry",
        externalIssue: "123",
      },
    });
  });

  it("ignores integrations whose configured domain does not match the URL", async () => {
    await expect(
      resolveExternalIssueLinkTarget({
        apiService: {
          listIssueIntegrations: async () => [
            integration({
              id: "1",
              name: "Jira Cloud",
              domainName: "other.atlassian.net",
              provider: { key: "jira" },
            }),
          ],
          getIssueIntegrationLinkConfig: async ({ integrationId }) =>
            linkConfig({
              id: integrationId,
              provider: { key: "jira" },
              linkIssueConfig: [{ name: "externalIssue", required: true }],
            }),
          listSentryAppInstallations: async () => [],
        },
        organizationSlug: "sentry",
        issueId: "PROJ-1",
        externalIssueUrl: "https://acme.atlassian.net/browse/PROJ-1",
      }),
    ).rejects.toThrow(/No installed jira issue integration/);
  });

  it("uses the first matching candidate when multiple integrations match", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [
          integration({ id: "1", name: "GitHub A", domainName: null }),
          integration({ id: "2", name: "GitHub B", domainName: null }),
        ],
        getIssueIntegrationLinkConfig: async () => linkConfig(),
        listSentryAppInstallations: async () => [],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl: "https://github.com/getsentry/sentry/issues/123",
    });

    expect(target).toMatchObject({
      kind: "native",
      integration: { id: "1" },
      payload: {
        repo: "getsentry/sentry",
        externalIssue: "123",
      },
    });
  });

  it("resolves Sentry App installations without exposing UUIDs", async () => {
    const target = await resolveExternalIssueLinkTarget({
      apiService: {
        listIssueIntegrations: async () => [],
        getIssueIntegrationLinkConfig: async () => {
          throw new Error("not used");
        },
        listSentryAppInstallations: async () => [installation()],
      },
      organizationSlug: "sentry",
      issueId: "PROJ-1",
      externalIssueUrl: "https://linear.app/acme/issue/ENG-123/test",
    });

    expect(target).toMatchObject({
      kind: "sentryApp",
      installation: { uuid: "linear-installation" },
      payload: {
        webUrl: "https://linear.app/acme/issue/ENG-123/test",
        project: "ENG",
        identifier: "ENG-123",
      },
    });
  });

  it("does not leak Sentry App installation UUIDs in ambiguity errors", async () => {
    await expect(
      resolveExternalIssueLinkTarget({
        apiService: {
          listIssueIntegrations: async () => [],
          getIssueIntegrationLinkConfig: async () => {
            throw new Error("not used");
          },
          listSentryAppInstallations: async () => [
            installation({ uuid: "secret-1" }),
            installation({ uuid: "secret-2" }),
          ],
        },
        organizationSlug: "sentry",
        issueId: "PROJ-1",
        externalIssueUrl: "https://linear.app/acme/issue/ENG-123/test",
      }),
    ).rejects.toThrow("Multiple installed Sentry Apps");
  });
});
