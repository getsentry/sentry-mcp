/**
 * Test setup for Cloudflare Workers tests.
 *
 * Keep setup-file work limited to runtime-agnostic polyfills. Cloudflare
 * worker-specific test APIs must be imported from actual test files.
 */
import "urlpattern-polyfill";
