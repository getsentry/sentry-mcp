interface ToolOutputRecord {
  [key: string]: unknown;
}

interface ToolContentPart {
  type: string;
}

interface TextToolContentPart extends ToolContentPart {
  type: "text";
  text: string;
}

function isRecord(value: unknown): value is ToolOutputRecord {
  return typeof value === "object" && value !== null;
}

function hasContentArray(
  value: unknown,
): value is ToolOutputRecord & { content: unknown[] } {
  return isRecord(value) && Array.isArray(value.content);
}

function hasStructuredContent(
  value: unknown,
): value is ToolOutputRecord & { structuredContent: unknown } {
  return isRecord(value) && "structuredContent" in value;
}

function hasLegacyToolResult(
  value: unknown,
): value is ToolOutputRecord & { toolResult: unknown } {
  return isRecord(value) && "toolResult" in value;
}

function isToolContentPart(value: unknown): value is ToolContentPart {
  return isRecord(value) && typeof value.type === "string";
}

function isTextToolContentPart(value: unknown): value is TextToolContentPart {
  return (
    isRecord(value) && value.type === "text" && typeof value.text === "string"
  );
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function formatToolOutputForDisplay(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  if (hasContentArray(output)) {
    const renderedContent = output.content
      .map((item) => {
        if (isTextToolContentPart(item)) {
          return item.text;
        }

        if (isToolContentPart(item)) {
          return `<${item.type} message>`;
        }

        return "<unknown message>";
      })
      .join("");

    if (renderedContent.length > 0) {
      return renderedContent;
    }
  }

  if (hasStructuredContent(output) && output.structuredContent !== undefined) {
    return stringifyUnknown(output.structuredContent);
  }

  if (hasLegacyToolResult(output)) {
    return stringifyUnknown(output.toolResult);
  }

  return stringifyUnknown(output);
}
