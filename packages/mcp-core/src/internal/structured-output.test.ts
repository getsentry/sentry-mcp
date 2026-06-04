import { describe, expect, it } from "vitest";
import { createStructuredDataPreview } from "./structured-output";

describe("createStructuredDataPreview", () => {
  it("uses the configured object key limit for depth summaries", () => {
    const preview = createStructuredDataPreview(
      {
        nested: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [`key${index}`, index]),
        ),
      },
      {
        depthLimit: 1,
        objectKeyLimit: 4,
      },
    );

    expect(preview).toEqual({
      truncated: true,
      data: {
        nested: {
          type: "object",
          keys: ["key0", "key1", "key2", "key3"],
        },
      },
    });
  });
});
