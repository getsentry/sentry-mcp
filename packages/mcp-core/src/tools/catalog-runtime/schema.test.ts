import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  findNestedJsonSchemaUnions,
  zodFieldMapToJsonSchema,
} from "./schema.js";

describe("findNestedJsonSchemaUnions", () => {
  it("allows a single property-level anyOf", () => {
    const schema = zodFieldMapToJsonSchema({
      regionUrl: z.string().nullable().optional(),
    });

    expect(findNestedJsonSchemaUnions(schema)).toEqual([]);
  });

  it("flags nested anyOf from union + nullable", () => {
    const schema = zodFieldMapToJsonSchema({
      environment: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .nullable()
        .optional(),
    });

    expect(findNestedJsonSchemaUnions(schema)).toEqual([
      "properties.environment.anyOf.0.anyOf",
    ]);
  });

  it("accepts a flat string|array optional union", () => {
    const schema = zodFieldMapToJsonSchema({
      environment: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .optional(),
    });

    expect(findNestedJsonSchemaUnions(schema)).toEqual([]);
    expect(schema).toMatchObject({
      properties: {
        environment: {
          anyOf: [
            { type: "string", minLength: 1 },
            {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
            },
          ],
        },
      },
    });
  });
});
