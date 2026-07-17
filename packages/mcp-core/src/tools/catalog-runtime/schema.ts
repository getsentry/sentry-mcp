import { z, type ZodTypeAny } from "zod";

export function zodFieldMapToJsonSchema(
  fieldMap: Record<string, ZodTypeAny>,
): Record<string, unknown> {
  const zodObject =
    Object.keys(fieldMap).length > 0 ? z.object(fieldMap) : z.object({});

  return z.toJSONSchema(zodObject, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
