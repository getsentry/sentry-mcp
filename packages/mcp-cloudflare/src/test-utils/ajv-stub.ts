/**
 * Stub for ajv module to bypass CJS require() issues in workerd runtime.
 *
 * The legacy MCP SDK imports ajv at module level even though the hosted v2 path
 * uses the SDK's workerd-compatible default validator. ajv uses CJS require()
 * for JSON files which fails in workerd.
 * See: https://github.com/cloudflare/workers-sdk/issues/9822
 *
 * This stub provides the minimal API surface required by that legacy import;
 * hosted MCP requests do not invoke it.
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
