import { describe, expect, test } from "vitest";
import { replace } from "../../../src/lib/init/replacers.js";

describe("replace", () => {
  test("exact match", () => {
    const result = replace("hello world", "world", "there");
    expect(result).toBe("hello there");
  });

  test("multiline exact match", () => {
    const content = "line1\nline2\nline3\n";
    const result = replace(content, "line2\n", "replaced\n");
    expect(result).toBe("line1\nreplaced\nline3\n");
  });

  test("throws when oldString not found", () => {
    expect(() => replace("hello", "missing", "x")).toThrow(
      "Could not find oldString"
    );
  });

  test("returns content unchanged when oldString equals newString", () => {
    const result = replace("hello world", "hello", "hello");
    expect(result).toBe("hello world");
  });

  test("throws on ambiguous match (multiple occurrences)", () => {
    expect(() => replace("aaa", "a", "b")).toThrow("multiple matches");
  });

  test("replaceAll replaces all occurrences", () => {
    const result = replace("a b a b a", "a", "x", true);
    expect(result).toBe("x b x b x");
  });

  describe("LineTrimmedReplacer", () => {
    test("matches despite different indentation", () => {
      const content = "  if (true) {\n    foo();\n  }";
      const result = replace(content, "if (true) {\n  foo();\n}", "replaced");
      expect(result).toBe("replaced");
    });

    test("matches with trailing spaces on lines", () => {
      const content = "function foo() {  \n  return 1;\n}";
      const result = replace(
        content,
        "function foo() {\n  return 1;\n}",
        "replaced"
      );
      expect(result).toBe("replaced");
    });
  });

  describe("BlockAnchorReplacer", () => {
    test("matches block by first/last line anchors with different middle", () => {
      const content = [
        "function setup() {",
        "  const a = 1;",
        "  const b = 2;",
        "  return a + b;",
        "}",
      ].join("\n");

      const search = [
        "function setup() {",
        "  const x = 1;",
        "  const y = 2;",
        "  return x + y;",
        "}",
      ].join("\n");

      const result = replace(content, search, "replaced");
      expect(result).toBe("replaced");
    });
  });

  describe("WhitespaceNormalizedReplacer", () => {
    test("matches with different whitespace runs", () => {
      const content = "import   {  foo  }   from  'bar';";
      const result = replace(content, "import { foo } from 'bar';", "replaced");
      expect(result).toBe("replaced");
    });
  });

  describe("IndentationFlexibleReplacer", () => {
    test("matches block with different indentation level", () => {
      const content = "    const x = 1;\n    const y = 2;";
      const result = replace(
        content,
        "  const x = 1;\n  const y = 2;",
        "replaced"
      );
      expect(result).toBe("replaced");
    });
  });

  describe("TrimmedBoundaryReplacer", () => {
    test("matches when search has extra whitespace around it", () => {
      const content = "hello world";
      const result = replace(content, "  hello world  ", "replaced");
      expect(result).toBe("replaced");
    });
  });

  describe("real-world Sentry codemod scenarios", () => {
    test("adding Sentry import to existing imports", () => {
      const content = [
        'import React from "react";',
        'import { useState } from "react";',
        "",
        "function App() {",
        "  return <div>Hello</div>;",
        "}",
      ].join("\n");

      const result = replace(
        content,
        'import React from "react";',
        'import React from "react";\nimport * as Sentry from "@sentry/react";'
      );

      expect(result).toContain("@sentry/react");
      expect(result).toContain('import React from "react"');
    });

    test("wrapping next.config.js default export", () => {
      const content = [
        "/** @type {import('next').NextConfig} */",
        "const nextConfig = {",
        "  reactStrictMode: true,",
        "};",
        "",
        "module.exports = nextConfig;",
      ].join("\n");

      const result = replace(
        content,
        "module.exports = nextConfig;",
        "module.exports = withSentryConfig(nextConfig, sentryOptions);"
      );

      expect(result).toContain("withSentryConfig(nextConfig, sentryOptions)");
      expect(result).toContain("reactStrictMode: true");
    });

    test("modifying sentry.client.config.ts init options", () => {
      const content = [
        'import * as Sentry from "@sentry/nextjs";',
        "",
        "Sentry.init({",
        '  dsn: "https://old-dsn@sentry.io/123",',
        "  tracesSampleRate: 1.0,",
        "});",
      ].join("\n");

      const result = replace(
        content,
        '  dsn: "https://old-dsn@sentry.io/123",',
        '  dsn: "https://new-dsn@sentry.io/456",'
      );

      expect(result).toContain("new-dsn@sentry.io/456");
      expect(result).not.toContain("old-dsn");
    });
  });
});
