import {
  SentryClientKeySchema,
  SentryDiscoverEventSchema,
  SentryEventSchema,
  SentryOrgSchema,
  SentryProjectSchema,
  SentryTeamSchema,
} from "../schema";
import { logError } from "./log";

const API_BASE_URL = "https://sentry.io/api/0";

export class SentryApiService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    return response;
  }

  async listOrganizations(): Promise<
    ReturnType<typeof SentryOrgSchema.parse>[]
  > {
    const response = await this.request("/organizations/");

    const orgsBody = await response.json<{ id: string; slug: string }[]>();
    return orgsBody.map((i) => SentryOrgSchema.parse(i));
  }

  async listTeams(
    organizationSlug: string
  ): Promise<ReturnType<typeof SentryTeamSchema.parse>[]> {
    const response = await this.request(
      `/organizations/${organizationSlug}/teams/`
    );

    const teamsBody = await response.json<{ id: string; slug: string }[]>();
    return teamsBody.map((i) => SentryTeamSchema.parse(i));
  }

  async createProject(
    organizationSlug: string,
    teamSlug: string,
    name: string,
    platform?: string
  ): Promise<
    [
      ReturnType<typeof SentryProjectSchema.parse>,
      ReturnType<typeof SentryClientKeySchema.parse> | null
    ]
  > {
    const response = await this.request(
      `/teams/${organizationSlug}/${teamSlug}/projects/`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          platform,
        }),
      }
    );
    const project = SentryProjectSchema.parse(await response.json());

    try {
      const keysResponse = await this.request(
        `/projects/${organizationSlug}/${project.slug}/keys/`
      );
      const clientKey = SentryClientKeySchema.parse(await keysResponse.json());
      return [project, clientKey];
    } catch (err) {
      logError(err);
    }
    return [project, null];
  }

  async getLatestEventForIssue(
    organizationSlug: string,
    issueId: string
  ): Promise<ReturnType<typeof SentryEventSchema.parse>> {
    const response = await this.request(
      `/organizations/${organizationSlug}/issues/${issueId}/events/latest/`
    );

    return SentryEventSchema.parse(await response.json());
  }

  async searchErrorsInFile(
    organizationSlug: string,
    filename: string,
    sortBy: "last_seen" | "count" = "last_seen"
  ): Promise<ReturnType<typeof SentryDiscoverEventSchema.parse>[]> {
    const query = `stack.filename:"*${filename.replace(/"/g, '\\"')}"`;
    const limit = 10;

    const apiUrl = `/organizations/${organizationSlug}/events/?dataset=errors&field=issue&field=title&field=project&field=last_seen%28%29&field=count%28%29&per_page=${limit}&query=${encodeURIComponent(
      query
    )}&referrer=sentry-mcp&sort=-${
      sortBy === "last_seen" ? "last_seen" : "count"
    }&statsPeriod=1w`;

    const response = await this.request(apiUrl);

    const listBody = await response.json<{ data: unknown[] }>();
    return listBody.data.map((i) => SentryDiscoverEventSchema.parse(i));
  }
}
