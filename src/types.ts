import { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { default as UserContext } from "./user-context";
import type { default as SentryMCP } from "./mcp";

export type Props = {
  id: string;
  name: string;
  accessToken: string;
  organizationSlug: string;
};

export type Env = {
  OAUTH_PROVIDER: OAuthHelpers;
  USER_CONTEXT: DurableObjectNamespace<UserContext>;
  MCP_OBJECT: DurableObjectNamespace<SentryMCP>;

  SENTRY_DSN: string;
  SENTRY_CLIENT_ID: string;
  SENTRY_CLIENT_SECRET: string;
};
