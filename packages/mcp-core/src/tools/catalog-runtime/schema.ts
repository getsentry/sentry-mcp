import { type ZodTypeAny, z } from "zod";

const UNION_KEYWORDS = ["anyOf", "oneOf", "allOf"] as const;

export function zodFieldMapToJsonSchema(
  fieldMap: Record<string, ZodTypeAny>,
): Record<string, unknown> {
  const zodObject =
    Object.keys(fieldMap).length > 0 ? z.object(fieldMap) : z.object({});

  const { $schema: _, ...jsonSchema } = z.toJSONSchema(zodObject, {
    io: "input",
    target: "draft-7",
    unrepresentable: "any",
  });
  return jsonSchema;
}

/**
 * Find JSON Schema union keywords nested inside another union.
 *
 * Nested unions (especially `anyOf` inside `anyOf`) are valid JSON Schema, but
 * some model APIs reject them when validating MCP tool input schemas. Prefer a
 * single flat union, or omit nullability when the property is already optional.
 */
export function findNestedJsonSchemaUnions(
  schema: unknown,
  path: string[] = [],
  insideUnion = false,
): string[] {
  if (!schema || typeof schema !== "object") {
    return [];
  }

  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) =>
      findNestedJsonSchemaUnions(item, path.concat(String(index)), insideUnion),
    );
  }

  const record = schema as Record<string, unknown>;
  const nestedPaths: string[] = [];

  for (const keyword of UNION_KEYWORDS) {
    const branches = record[keyword];
    if (!Array.isArray(branches)) {
      continue;
    }

    const nextPath = path.concat(keyword);
    if (insideUnion) {
      nestedPaths.push(nextPath.join("."));
    }

    nestedPaths.push(...findNestedJsonSchemaUnions(branches, nextPath, true));
  }

  for (const [key, value] of Object.entries(record)) {
    if ((UNION_KEYWORDS as readonly string[]).includes(key)) {
      continue;
    }
    nestedPaths.push(
      ...findNestedJsonSchemaUnions(value, path.concat(key), insideUnion),
    );
  }

  return nestedPaths;
}
