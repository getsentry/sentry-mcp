# Dependency patches

## MCP server 2.0.0 protocol validation

`@modelcontextprotocol__server@2.0.0.patch` backports two upstream fixes to the
published server package used by Cloudflare Agents:

- [TypeScript SDK #2590](https://linear.review/modelcontextprotocol/typescript-sdk/pull/2590),
  commit `75dc7ea6e2913e1ac37d4f06eec62cd5cfac9e7a`: reject a modern HTTP
  request without `MCP-Protocol-Version` with HTTP 400 / `-32020`. The presence
  check follows protocol classification, preserving headerless legacy initialize
  requests and unsupported-version error precedence.
- [TypeScript SDK #2492](https://linear.review/modelcontextprotocol/typescript-sdk/pull/2492),
  proposed in commit `a1899fda37fb0cc62aadacb43acb3c24efcdbd44`:
  return `-32602 InvalidParams` when a registered request fails its method schema,
  instead of `-32603 InternalError`. Handler exceptions and notification validation
  keep their existing behavior.

These rules follow the MCP 2026-07-28 specifications for
[HTTP request headers](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation)
and [pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination#error-handling).

Both ESM and CommonJS builds are patched. The private `core-internal` code is
bundled inside this package; no separate core package patch is needed. Dependency
versions remain unchanged, including Agents' exact server peer dependency. The
header fix is merged upstream; #2492 remains open as of September 18, 2026. Neither
is present in the published server 2.0.0 package.

Remove this patch and its `patchedDependencies` entry when adopting a published
SDK release containing both fixes and compatible with Agents. Keep the hosted
protocol regression tests and the Node ESM/CommonJS tests when upgrading.
