import { z, type ZodTypeAny } from "zod";

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
