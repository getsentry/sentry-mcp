import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UserInputError } from "../errors";
import { apiPath } from "./api-path";

/**
 * The assertions below resolve each path the way `fetch` does, because dot-segment
 * normalization happens during URL parsing rather than in our code. A test that only
 * inspected the assembled string would pass even if traversal still worked.
 */
function resolve(path: string): string {
  const url = new URL(`https://sentry.io/api/0${path}`);
  return url.pathname + url.search;
}

describe("apiPath", () => {
  it("leaves legitimate identifier formats byte for byte", () => {
    const cases = [
      "my-org",
      "my_project.name",
      "1234567890",
      "cfe78a5c892d4a64a962d837673398d2",
      "7e07485f-12f9-416b-8b14-26260799b51f",
      "PROJECT-1Z43",
      "latest",
    ];

    for (const value of cases) {
      expect(apiPath`/projects/${value}/`).toBe(`/projects/${value}/`);
    }
  });

  it("accepts numeric values", () => {
    expect(apiPath`/projects/${4511636893859840}/`).toBe(
      "/projects/4511636893859840/",
    );
  });

  it("handles templates with no interpolation", () => {
    expect(apiPath`/organizations/`).toBe("/organizations/");
  });

  it("handles adjacent interpolations", () => {
    expect(apiPath`/${"a"}${"b"}/`).toBe("/ab/");
  });

  describe("traversal containment", () => {
    it("keeps a traversal payload inside its own segment", () => {
      const attack = "../../../victim-org/victim-proj/events/abc";
      const path = apiPath`/projects/my-org/my-proj/events/${attack}/attachments/`;

      expect(resolve(path)).toBe(
        "/api/0/projects/my-org/my-proj/events/..%2F..%2F..%2Fvictim-org%2Fvictim-proj%2Fevents%2Fabc/attachments/",
      );
    });

    it("resolves the unencoded equivalent out of scope, proving the test is meaningful", () => {
      const attack = "../../../victim-org/victim-proj/events/abc";
      const unsafe = `/projects/my-org/my-proj/events/${attack}/attachments/`;

      expect(resolve(unsafe)).toBe(
        "/api/0/projects/victim-org/victim-proj/events/abc/attachments/",
      );
    });

    /**
     * VULN-2450 specifically asked that a patch be retested against these variants,
     * since encode-only fixes for this bug class have historically been bypassable.
     *
     * Each payload must survive URL resolution as exactly one inert path segment.
     * Asserting the whole resolved path (rather than searching for the payload text,
     * which is still present once encoded) is what proves no segment boundary,
     * query separator or fragment escaped.
     */
    it.each([
      ["plain dot segments", "../../other-org/other-proj"],
      ["double encoded dots", "%252e%252e%252fother-org"],
      ["single encoded dots", "%2e%2e%2fother-org"],
      ["recursive sequences", "....//....//other-org"],
      ["backslash separators", "..\\..\\other-org"],
      ["mixed separators", "..\\../other-org"],
      ["null byte", "abc\u0000/../other-org"],
      ["fragment truncation", "abc/#"],
      ["query injection", "abc/?download=1&x=2"],
      ["scheme relative", "//evil.example.com/x"],
      ["absolute path", "/organizations/other-org/members"],
      ["trailing dot segment", "abc/.."],
      ["dots with a suffix", "..a"],
      ["dots with a prefix", "a.."],
      ["three dots", "..."],
    ])("contains %s", (_label, attack) => {
      const resolved = resolve(
        apiPath`/projects/my-org/my-proj/events/${attack}/`,
      );

      expect(resolved).toBe(
        `/api/0/projects/my-org/my-proj/events/${encodeURIComponent(attack)}/`,
      );
    });

    it("cannot redirect the request to another host", () => {
      const attack = "//evil.example.com/collect";
      const url = new URL(
        `https://sentry.io/api/0${apiPath`/projects/o/p/events/${attack}/`}`,
      );

      expect(url.host).toBe("sentry.io");
    });

    it("cannot append query parameters to the request", () => {
      const url = new URL(
        `https://sentry.io/api/0${apiPath`/projects/o/p/events/${"abc/?download=1"}/`}`,
      );

      expect(url.search).toBe("");
    });
  });

  /**
   * A value that is entirely a dot segment carries no separator, so encoding leaves
   * it intact and the URL parser still collapses it. It cannot reach another tenant
   * (that needs a `/` to name one) but it does consume a preceding segment and move
   * the request to a different endpoint, so it has to be rejected rather than encoded.
   */
  describe("bare dot segments", () => {
    it.each([".", ".."])("rejects %s", (attack) => {
      expect(() => apiPath`/projects/o/p/keys/${attack}/`).toThrow(
        UserInputError,
      );
    });

    it("would otherwise consume the preceding segment", () => {
      // Demonstrates why encoding cannot solve this: the encoded form still collapses.
      expect(resolve(`/projects/o/p/keys/${encodeURIComponent("..")}/`)).toBe(
        "/api/0/projects/o/p/",
      );
      expect(resolve("/projects/o/p/keys/%2e%2e/")).toBe(
        "/api/0/projects/o/p/",
      );
    });

    /**
     * A percent-encoded spelling arriving as *input* is already inert, because the `%`
     * itself gets encoded (`%2e%2e` becomes `%252e%252e`). These must be contained
     * rather than rejected, so that a legitimate value is never refused.
     */
    it.each(["%2e", "%2E", "%2e%2e", ".%2e", "%2e."])(
      "contains rather than rejects %s",
      (value) => {
        expect(() => apiPath`/projects/o/p/keys/${value}/`).not.toThrow();
        expect(resolve(apiPath`/projects/o/p/keys/${value}/`)).toBe(
          `/api/0/projects/o/p/keys/${encodeURIComponent(value)}/`,
        );
      },
    );

    it("still accepts identifiers that merely contain dots", () => {
      for (const value of ["1.2.3", "my.project", "...", "..a", "a.."]) {
        expect(() => apiPath`/projects/o/p/keys/${value}/`).not.toThrow();
      }
    });
  });
});

/**
 * The slug-only fix in VULN-848 hardened the parameters that were vulnerable at the
 * time and left the resource IDs raw, which is how VULN-2159/2450 happened years
 * later. Enumerating parameters does not hold; enforcing the invariant does.
 *
 * This fails on any newly added request path that interpolates a value without the
 * `apiPath` tag, so the class cannot be reintroduced by a tool author who is unaware
 * of it.
 */
describe("client.ts request path invariant", () => {
  const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

  /**
   * Returns the path portion of a template literal body, stopping at the query
   * separator. Only interpolation before the `?` needs the `apiPath` tag; query
   * values are already encoded by `URLSearchParams` and must keep their separators
   * literal.
   */
  function pathPortion(body: string): string {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "$" && body[i + 1] === "{") {
        depth++;
        i++;
      } else if (body[i] === "}" && depth > 0) {
        depth--;
      } else if (body[i] === "?" && depth === 0) {
        return body.slice(0, i);
      }
    }
    return body;
  }

  it("interpolates every request path through apiPath", () => {
    const offenders: string[] = [];

    source.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      // A template literal opening with a slash is an API request path.
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] !== "`" || line[i + 1] !== "/") continue;

        const closing = line.indexOf("`", i + 1);
        const body = line.slice(i + 1, closing === -1 ? undefined : closing);
        const isTagged = line.slice(0, i).endsWith("apiPath");
        const interpolatesPath = /\$\{/.test(pathPortion(body));

        if (!isTagged && interpolatesPath) {
          offenders.push(`${index + 1}: ${trimmed}`);
        }
      }
    });

    expect(
      offenders,
      `Request paths must be built with the apiPath tag so interpolated values cannot escape their segment:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("does not double-encode inside an apiPath template", () => {
    const doubleEncoded = [...source.matchAll(/apiPath`[^`]*`/g)]
      .map((match) => match[0])
      .filter((template) => template.includes("encodeURIComponent"));

    expect(doubleEncoded).toEqual([]);
  });
});
