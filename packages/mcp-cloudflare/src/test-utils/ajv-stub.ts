/**
 * Stub for ajv module to bypass CJS require() issues in workerd runtime.
 *
 * The MCP SDK imports ajv at module level (even when using CfWorkerJsonSchemaValidator).
 * ajv uses CJS require() for JSON files which fails in workerd.
 * See: https://github.com/cloudflare/workers-sdk/issues/9822
 *
 * This stub provides the minimal API surface that the SDK imports,
 * but is never actually used since we use CfWorkerJsonSchemaValidator.
 */

export class Ajv {
  compile() {
    return () => true;
  }

  getSchema() {
    return undefined;
  }

  errorsText() {
    return "";
  }
}

export default Ajv;
