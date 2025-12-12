import { buildCommand, numberParser } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { getConfigPath, isAuthenticated } from "../../lib/config.js";
import {
  completeOAuthFlow,
  openBrowser,
  performDeviceFlow,
  setApiToken,
} from "../../lib/oauth.js";

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
};

export const loginCommand = buildCommand({
  docs: {
    brief: "Authenticate with Sentry",
    fullDescription:
      "Log in to Sentry using OAuth or an API token.\n\n" +
      "The OAuth flow uses a device code - you'll be given a code to enter at a URL.\n" +
      "Alternatively, use --token to authenticate with an existing API token.",
  },
  parameters: {
    flags: {
      token: {
        kind: "parsed",
        parse: String,
        brief: "Authenticate using an API token instead of OAuth",
        optional: true,
      },
      timeout: {
        kind: "parsed",
        parse: numberParser,
        brief: "Timeout for OAuth flow in seconds (default: 900)",
        default: 900,
      },
    },
  },
  async func(this: SryContext, flags: LoginFlags): Promise<void> {
    const { process } = this;

    // Check if already authenticated
    if (isAuthenticated()) {
      process.stdout.write(
        "You are already authenticated. Use 'sry auth logout' first to re-authenticate.\n"
      );
      return;
    }

    // Token-based authentication
    if (flags.token) {
      setApiToken(flags.token);
      process.stdout.write("✓ Authenticated with API token\n");
      process.stdout.write(`  Config saved to: ${getConfigPath()}\n`);
      return;
    }

    // Device Flow OAuth
    process.stdout.write("Starting authentication...\n\n");

    try {
      const tokenResponse = await performDeviceFlow(
        {
          onUserCode: async (userCode, verificationUri) => {
            process.stdout.write(`Opening browser to: ${verificationUri}\n\n`);
            process.stdout.write(`Enter code: ${userCode}\n\n`);
            process.stdout.write("Waiting for authorization...\n");
            await openBrowser(verificationUri);
          },
          onPolling: () => {
            // Could add a spinner or dots here
            process.stdout.write(".");
          },
        },
        flags.timeout * 1000
      );

      // Clear the polling dots
      process.stdout.write("\n\n");

      // Store the token
      completeOAuthFlow(tokenResponse);

      process.stdout.write("✓ Authentication successful!\n");
      process.stdout.write(`  Config saved to: ${getConfigPath()}\n`);

      if (tokenResponse.expires_in) {
        const hours = Math.round(tokenResponse.expires_in / 3600);
        process.stdout.write(`  Token expires in: ${hours} hours\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n✗ Authentication failed: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
