import { describe, expect, test } from "vitest";
import { formatTimestamp } from "../../../src/lib/formatters/sixel-dashboard.js";

describe("formatTimestamp", () => {
  const timestamp = Date.UTC(2024, 0, 15, 10, 30) / 1000;
  const date = new Date(timestamp * 1000);

  test("uses clock time for periods shorter than two days", () => {
    expect(formatTimestamp(timestamp, 1)).toBe(
      `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    );
  });

  test("formats the Unix epoch instead of treating it as missing", () => {
    const epoch = new Date(0);
    expect(formatTimestamp(0, 1)).toBe(
      `${String(epoch.getHours()).padStart(2, "0")}:${String(epoch.getMinutes()).padStart(2, "0")}`
    );
    expect(formatTimestamp(0, 7)).toBe(
      `${String(epoch.getMonth() + 1).padStart(2, "0")}/${String(epoch.getDate()).padStart(2, "0")}`
    );
  });

  test("uses calendar dates for multi-day periods", () => {
    expect(formatTimestamp(timestamp, 7)).toBe(
      `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
    );
    expect(formatTimestamp(timestamp, 31)).toBe(`Jan ${date.getDate()}`);
  });
});
