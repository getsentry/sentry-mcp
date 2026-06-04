import { isTopLevelToolName } from "../../tools/surfaces";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function formatArgumentValue(value: JsonValue): string {
  if (typeof value === "string") {
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  }

  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatArguments(args: Record<string, JsonValue>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}=${formatArgumentValue(value)}`)
    .join(", ");
}

function formatArgumentsJson(args: Record<string, JsonValue>): string {
  return JSON.stringify(args);
}

function isToolAvailable(
  toolName: string,
  availableToolNames: ReadonlySet<string> | undefined,
): boolean {
  return !availableToolNames || availableToolNames.has(toolName);
}

function isDirectTool(
  toolName: string,
  experimentalMode: boolean,
  directToolNames: ReadonlySet<string> | undefined,
): boolean {
  return directToolNames
    ? directToolNames.has(toolName)
    : isTopLevelToolName(toolName, experimentalMode);
}

export function formatToolCall({
  toolName,
  arguments: args = {},
}: {
  toolName: string;
  arguments?: Record<string, JsonValue>;
}): string {
  const formattedArgs = formatArguments(args);
  return `${toolName}(${formattedArgs})`;
}

export function formatToolCallInstruction({
  toolName,
  arguments: args = {},
  experimentalMode,
  searchQuery = toolName,
  availableToolNames,
  directToolNames,
  fallbackInstruction,
}: {
  toolName: string;
  arguments?: Record<string, JsonValue>;
  experimentalMode: boolean;
  searchQuery?: string;
  availableToolNames?: ReadonlySet<string>;
  directToolNames?: ReadonlySet<string>;
  fallbackInstruction?: string;
}): string {
  const targetAvailable = isToolAvailable(toolName, availableToolNames);

  if (
    targetAvailable &&
    isDirectTool(toolName, experimentalMode, directToolNames)
  ) {
    return `Use the Sentry tool \`${formatToolCall({
      toolName,
      arguments: args,
    })}\``;
  }

  const catalogGatewayAvailable =
    experimentalMode &&
    isToolAvailable("search_tools", availableToolNames) &&
    isToolAvailable("execute_tool", availableToolNames) &&
    isDirectTool("search_tools", experimentalMode, directToolNames) &&
    isDirectTool("execute_tool", experimentalMode, directToolNames);

  if (targetAvailable && catalogGatewayAvailable) {
    return [
      `Use the Sentry tool \`${toolName}\`:`,
      `search \`${formatToolCall({
        toolName: "search_tools",
        arguments: { query: searchQuery },
      })}\`,`,
      `then call \`execute_tool\` with name \`${toolName}\` and arguments \`${formatArgumentsJson(args)}\``,
    ].join(" ");
  }

  return (
    fallbackInstruction ??
    `The Sentry tool \`${toolName}\` is not available in this session`
  );
}
