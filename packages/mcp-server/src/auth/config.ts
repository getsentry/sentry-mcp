import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CONFIG_DIR_NAME } from "./constants.js";

export interface OAuthClientConfig {
  clientId: string;
  mcpHost: string;
  registeredAt: string;
  accessToken?: string;
  tokenExpiresAt?: string;
}

export interface ClientConfigFile {
  oauthClients: Record<string, OAuthClientConfig>;
}

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor() {
    this.configDir = join(homedir(), CONFIG_DIR_NAME);
    this.configFile = join(this.configDir, "config.json");
  }

  /**
   * Ensure config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore EEXIST errors
      if ((error as any).code !== "EEXIST") {
        throw error;
      }
    }
  }

  /**
   * Load config file
   */
  private async loadConfig(): Promise<ClientConfigFile> {
    try {
      const content = await fs.readFile(this.configFile, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      // Config file doesn't exist or is invalid, return empty config
      return { oauthClients: {} };
    }
  }

  /**
   * Save config file
   */
  private async saveConfig(config: ClientConfigFile): Promise<void> {
    await this.ensureConfigDir();
    await fs.writeFile(
      this.configFile,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  /**
   * Get OAuth client ID for a specific MCP host
   */
  async getOAuthClientId(mcpHost: string): Promise<string | null> {
    const config = await this.loadConfig();
    const clientConfig = config.oauthClients[mcpHost];
    return clientConfig?.clientId || null;
  }

  /**
   * Store OAuth client ID for a specific MCP host
   */
  async setOAuthClientId(mcpHost: string, clientId: string): Promise<void> {
    const config = await this.loadConfig();

    // Preserve existing access token if present
    const existing = config.oauthClients[mcpHost];
    config.oauthClients[mcpHost] = {
      clientId,
      mcpHost,
      registeredAt: new Date().toISOString(),
      accessToken: existing?.accessToken,
      tokenExpiresAt: existing?.tokenExpiresAt,
    };

    await this.saveConfig(config);
  }

  /**
   * Remove OAuth client configuration for a specific MCP host
   */
  async removeOAuthClientId(mcpHost: string): Promise<void> {
    const config = await this.loadConfig();
    delete config.oauthClients[mcpHost];
    await this.saveConfig(config);
  }

  /**
   * Get cached access token for a specific MCP host
   */
  async getAccessToken(mcpHost: string): Promise<string | null> {
    const config = await this.loadConfig();
    const clientConfig = config.oauthClients[mcpHost];

    if (!clientConfig?.accessToken) {
      return null;
    }

    // Check if token is expired
    if (clientConfig.tokenExpiresAt) {
      const expiresAt = new Date(clientConfig.tokenExpiresAt);
      const now = new Date();
      // Add 5 minute buffer before expiration
      const bufferTime = 5 * 60 * 1000;

      if (now.getTime() + bufferTime >= expiresAt.getTime()) {
        // Token is expired or will expire soon
        await this.removeAccessToken(mcpHost);
        return null;
      }
    }

    return clientConfig.accessToken;
  }

  /**
   * Store access token for a specific MCP host
   */
  async setAccessToken(
    mcpHost: string,
    accessToken: string,
    expiresIn?: number,
  ): Promise<void> {
    const config = await this.loadConfig();

    const existing = config.oauthClients[mcpHost];
    if (!existing) {
      throw new Error(`No OAuth client configuration found for ${mcpHost}`);
    }

    let tokenExpiresAt: string | undefined;
    if (expiresIn) {
      // expiresIn is in seconds, convert to milliseconds
      const expiresAtMs = Date.now() + expiresIn * 1000;
      tokenExpiresAt = new Date(expiresAtMs).toISOString();
    }

    config.oauthClients[mcpHost] = {
      ...existing,
      accessToken,
      tokenExpiresAt,
    };

    await this.saveConfig(config);
  }

  /**
   * Remove cached access token for a specific MCP host
   */
  async removeAccessToken(mcpHost: string): Promise<void> {
    const config = await this.loadConfig();
    const existing = config.oauthClients[mcpHost];

    if (existing) {
      config.oauthClients[mcpHost] = {
        ...existing,
        accessToken: undefined,
        tokenExpiresAt: undefined,
      };
      await this.saveConfig(config);
    }
  }

  /**
   * Clear all cached tokens (useful for re-authentication)
   */
  async clearAllTokens(): Promise<void> {
    const config = await this.loadConfig();

    for (const [host, clientConfig] of Object.entries(config.oauthClients)) {
      config.oauthClients[host] = {
        ...clientConfig,
        accessToken: undefined,
        tokenExpiresAt: undefined,
      };
    }

    await this.saveConfig(config);
  }

  /**
   * List all registered OAuth clients
   */
  async listOAuthClients(): Promise<OAuthClientConfig[]> {
    const config = await this.loadConfig();
    return Object.values(config.oauthClients);
  }
}
