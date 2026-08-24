import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  findIncompatibleJsonSchemaUnions,
  zodFieldMapToJsonSchema,
} from "./schema.js";

describe("findIncompatibleJsonSchemaUnions", () => {
  it("allows a single property-level anyOf", () => {
    const schema = zodFieldMapToJsonSchema({
      regionUrl: z.string().nullable().optional(),
    });

    expect(findIncompatibleJsonSchemaUnions(schema)).toEqual([]);
  });

  it("flags nested anyOf from union + nullable", () => {
    const schema = zodFieldMapToJsonSchema({
      environment: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .nullable()
        .optional(),
    });

    expect(findIncompatibleJsonSchemaUnions(schema)).toEqual([
      {
        path: "properties.environment.anyOf.0.anyOf",
        reason: "nested-union",
        keyword: "anyOf",
      },
    ]);
  });

  it("flags root-level anyOf", () => {
    const schema = {
      anyOf: [
        {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      ],
    };

    expect(findIncompatibleJsonSchemaUnions(schema)).toEqual([
      {
        path: "anyOf",
        reason: "root-union",
        keyword: "anyOf",
      },
    ]);
  });

  it("accepts a flat string|array optional union", () => {
    const schema = zodFieldMapToJsonSchema({
      environment: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .optional(),
    });

    expect(findIncompatibleJsonSchemaUnions(schema)).toEqual([]);
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
