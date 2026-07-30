/**
 * Safe construction of Sentry API request paths.
 *
 * Request paths are handed to `fetch`, which resolves dot segments per the WHATWG
 * URL spec before the request leaves the process. Interpolating a caller supplied
 * value straight into a path therefore lets that value rewrite the path above the
 * organization and project the server injected, reaching endpoints the session was
 * never scoped to.
 *
 * `apiPath` closes that in two ways, because encoding alone is not sufficient:
 *
 * 1. Separators are percent-encoded, so a value cannot introduce new path segments.
 * 2. A value that is *entirely* a dot segment is rejected. `encodeURIComponent`
 *    leaves `.` and `..` untouched, and the URL spec also treats the percent-encoded
 *    forms (`%2e`, `%2e%2e`) as dot segments, so no amount of encoding neutralises
 *    them. Such a value would still collapse and consume a preceding segment.
 *
 * Together these mean an interpolated value occupies exactly the one path segment it
 * was written into. Parameter level format validation is applied separately in the
 * tool schemas for better error messages, but this layer is what holds for
 * parameters nobody remembered to validate.
 *
 * Query strings must be appended outside the template, because `URLSearchParams`
 * has already encoded them and the separators must stay literal:
 *
 * ```typescript
 * const path = apiPath`/organizations/${organizationSlug}/issues/`;
 * const body = await this.requestJSON(`${path}?${query}`);
 * ```
 */
import { UserInputError } from "../errors";

/**
 * Matches a segment the URL parser would treat as a single- or double-dot segment.
 *
 * Per the WHATWG URL spec these comparisons are ASCII case-insensitive and include
 * the percent-encoded spellings of `.`, which is why encoding cannot be used to make
 * such a value inert.
 */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Interpolates values into an API path, percent-encoding each one.
 *
 * `encodeURIComponent` leaves `A-Za-z0-9`, `-`, `_`, `.`, `!`, `~`, `*`, `'`, `(`
 * and `)` untouched, so every legitimate Sentry slug, numeric ID, hex ID, UUID and
 * short ID passes through byte for byte. Only separators change, which is exactly
 * the intent.
 *
 * @param strings Literal portions of the template
 * @param values Caller supplied values to encode into single path segments
 * @returns The assembled path with every interpolated value encoded
 * @throws {UserInputError} If a value is entirely a dot segment, since such a value
 *   cannot be contained by encoding and no legitimate Sentry identifier takes that
 *   form.
 */
export function apiPath(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string {
  return strings.reduce((acc, literal, index) => {
    if (index >= values.length) {
      return acc + literal;
    }

    const encoded = encodeURIComponent(String(values[index]));
    if (DOT_SEGMENT.test(encoded)) {
      throw new UserInputError(
        `Invalid identifier "${values[index]}": relative path segments are not allowed.`,
      );
    }

    return acc + literal + encoded;
  }, "");
}
