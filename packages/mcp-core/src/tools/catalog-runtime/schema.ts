import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function zodFieldMapToJsonSchema(
  fieldMap: Record<string, ZodTypeAny>,
): Record<string, unknown> {
  const zodObject =
    Object.keys(fieldMap).length > 0 ? z.object(fieldMap) : z.object({});

  return zodTypeToJsonSchema(zodObject);
}

export function zodTypeToJsonSchema(
  schema: ZodTypeAny,
): Record<string, unknown> {
  return zodToJsonSchema(schema, {
    $refStrategy: "none",
    strictUnions: true,
    pipeStrategy: "input",
  }) as Record<string, unknown>;
}
