import { z } from "zod";
import toolDefinitionsData from "./toolDefinitions.json";

// Zod schema for tool parameter
const ToolParameterSchema = z
  .object({
    type: z.string().optional(),
    description: z.string().optional(),
    anyOf: z.array(z.any()).optional(),
    $schema: z.string().optional(),
    enum: z.array(z.string()).optional(),
    // Allow additional properties for flexibility
  })
  .passthrough();

// Zod schema for tool definition
const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), ToolParameterSchema),
});

// Array of tool definitions
const ToolDefinitionsSchema = z.array(ToolDefinitionSchema);

// Parse and validate the imported JSON data
const parseResult = ToolDefinitionsSchema.safeParse(toolDefinitionsData);

if (!parseResult.success) {
  throw new Error(
    `Invalid tool definitions JSON structure: ${parseResult.error.message}`,
  );
}

const toolDefinitions = parseResult.data;

// Export inferred types from Zod schemas
export type ToolParameter = z.infer<typeof ToolParameterSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// Export schemas for reuse if needed
export { ToolParameterSchema, ToolDefinitionSchema, ToolDefinitionsSchema };

export default toolDefinitions;
