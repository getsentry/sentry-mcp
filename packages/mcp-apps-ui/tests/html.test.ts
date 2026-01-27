import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderErrorHtml,
  renderNumberDisplayHtml,
  renderTableHtml,
} from "../src/shared/html";

const maliciousValue = '<img src=x onerror="globalThis.pwned=true">';

describe("safe chart markup", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes dynamic values in number, table, and error displays", () => {
    const markup = [
      renderNumberDisplayHtml(maliciousValue, maliciousValue),
      renderTableHtml([{ [maliciousValue]: maliciousValue }], [maliciousValue]),
      renderErrorHtml(maliciousValue),
    ].join("\n");

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain(maliciousValue);
    expect(markup).toContain(
      "&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;",
    );
  });
});
