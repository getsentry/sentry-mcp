/**
 * TEMPORARY STUB for SentryMCP Durable Object migration
 *
 * This file exists ONLY to allow Cloudflare to apply the deleted_classes migration.
 * Once the migration is deployed and all Durable Object instances are deleted,
 * this file should be removed.
 *
 * DO NOT USE THIS CLASS - it's a stub for migration purposes only.
 */

/**
 * Minimal stub of SentryMCP class for migration purposes.
 *
 * Cloudflare requires the class to exist in the code when applying
 * a deleted_classes migration so it can delete all existing instances.
 */
export class SentryMCP {
  async fetch(request: Request): Promise<Response> {
    return new Response(
      "This Durable Object is being migrated. Please reconnect.",
      { status: 503 },
    );
  }
}
