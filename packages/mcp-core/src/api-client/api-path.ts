/**
 * Safe construction of Sentry API request paths.
 *
 * Request paths are handed to `fetch`, which resolves `../` dot segments per the
 * WHATWG URL spec before the request leaves the process. Interpolating a caller
 * supplied value straight into a path therefore lets that value rewrite the path
 * above the organization and project the server injected, reaching endpoints the
 * session was never scoped to.
 *
 * `apiPath` encodes every interpolated value so it can only ever occupy the single
 * path segment it was written into. Encoding is the structural defence: parameter
 * level format validation is applied separately in the tool schemas for better
 * error messages, but this layer is what holds for parameters nobody remembered to
 * validate.
 *
 * Query strings must be appended outside the template, because `URLSearchParams`
 * has already encoded them and the separators must stay literal:
 *
 * ```typescript
 * const path = `${apiPath`/organizations/${organizationSlug}/issues/`}?${query}`;
 * ```
 */

/**
 * Interpolates values into an API path, percent-encoding each one.
 *
 * `encodeURIComponent` leaves `A-Za-z0-9`, `-`, `_`, `.`, `!`, `~`, `*`, `'`, `(`
 * and `)` untouched, so every legitimate Sentry slug, numeric ID, hex ID, UUID and
 * short ID passes through byte for byte. Only separators and traversal sequences
 * change, which is exactly the intent.
 *
 * @param strings Literal portions of the template
 * @param values Caller supplied values to encode into single path segments
 * @returns The assembled path with every interpolated value encoded
 */
export function apiPath(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string {
  return strings.reduce((acc, literal, index) => {
    if (index >= values.length) {
      return acc + literal;
    }
    return acc + literal + encodeURIComponent(String(values[index]));
  }, "");
}
