import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import { openBrowser } from "../../lib/browser.js";
import {
  clearAuth,
  getConfigPath,
  isAuthenticated,
  setAuthToken,
} from "../../lib/config.js";
import { AuthError } from "../../lib/errors.js";
import { completeOAuthFlow, performDeviceFlow } from "../../lib/oauth.js";
import { generateQRCode } from "../../lib/qrcode.js";

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
  readonly qr: boolean;
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
      qr: {
        kind: "boolean",
        brief: "Show QR code for mobile scanning",
        default: true,
      },
    },
  },
  async func(this: SentryContext, flags: LoginFlags): Promise<void> {
    const { stdout } = this;

    // Check if already authenticated
    if (await isAuthenticated()) {
      stdout.write(
        "You are already authenticated. Use 'sentry auth logout' first to re-authenticate.\n"
      );
      return;
    }

    // Token-based authentication
    if (flags.token) {
      // Save token first, then validate by making an API call
      await setAuthToken(flags.token);

      // Validate the token by trying to list organizations
      try {
        await listOrganizations();
      } catch {
        // Token is invalid - clear it and throw
        await clearAuth();
        throw new AuthError(
          "invalid",
          "Invalid API token. Please check your token and try again."
        );
      }

      stdout.write("✓ Authenticated with API token\n");
      stdout.write(`  Config saved to: ${getConfigPath()}\n`);
      return;
    }

    // Device Flow OAuth
    stdout.write("Starting authentication...\n\n");

    const tokenResponse = await performDeviceFlow(
      {
        onUserCode: async (
          userCode,
          verificationUri,
          verificationUriComplete
        ) => {
          const browserOpened = await openBrowser(verificationUriComplete);
          if (browserOpened) {
            stdout.write("Opening browser...\n\n");
          }

          if (flags.qr) {
            stdout.write("Scan this QR code or visit the URL below:\n\n");
            const qr = await generateQRCode(verificationUriComplete);
            stdout.write(qr);
            stdout.write("\n");
          }

          stdout.write(`URL: ${verificationUri}\n`);
          stdout.write(`Code: ${userCode}\n\n`);
          stdout.write("Waiting for authorization...\n");
        },
        onPolling: () => {
          // Could add a spinner or dots here
          stdout.write(".");
        },
      },
      flags.timeout * 1000
    );

    // Clear the polling dots
    stdout.write("\n\n");

    // Store the token
    await completeOAuthFlow(tokenResponse);

    stdout.write("✓ Authentication successful!\n");
    stdout.write(`  Config saved to: ${getConfigPath()}\n`);

    if (tokenResponse.expires_in) {
      const hours = Math.round(tokenResponse.expires_in / 3600);
      stdout.write(`  Token expires in: ${hours} hours\n`);
    }
  },
});
