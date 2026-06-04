import { z } from "zod";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { setTag } from "@sentry/core";
import { isEnabledBySkills, type Skill } from "../../skills";
import {
  getConstraintKeysToFilter,
  getConstraintParametersToInject,
} from "../../internal/constraint-helpers";
import { UserInputError } from "../../errors";
import type { ProjectCapabilities, ServerContext } from "../../types";
import {
  isCatalogInfrastructureToolName,
  isDefaultTopLevelToolName,
  isOutsideCatalogToolName,
} from "../surfaces";
import {
  type ToolConfig,
  isToolVisibleInMode,
  resolveDescription,
} from "../types";

export type ToolRegistry = Record<string, ToolConfig<any>>;

export interface ToolWithContext {
  key: string;
  tool: ToolConfig<any>;
  isCatalogTool: boolean;
  isTopLevel: boolean;
}

export interface CatalogContext {
  context: ServerContext;
  experimentalMode: boolean;
  useDefaultSurfacePolicy: boolean;
}

function getToolPlacement({
  key,
  useDefaultSurfacePolicy,
}: {
  key: string;
  useDefaultSurfacePolicy: boolean;
}): {
  isCatalogTool: boolean;
  isTopLevel: boolean;
} {
  if (useDefaultSurfacePolicy) {
    return {
      isCatalogTool: !isOutsideCatalogToolName(key),
      isTopLevel: isDefaultTopLevelToolName(key),
    };
  }

  // Custom registries are direct by default so existing tests and local mocks
  // do not need a central surface assignment.
  return { isCatalogTool: true, isTopLevel: true };
}

function hasRequiredCapabilities({
  tool,
  context,
  experimentalMode,
}: {
  tool: ToolConfig<any>;
  context: ServerContext;
  experimentalMode: boolean;
}): boolean {
  if (
    !experimentalMode ||
    !context.constraints.projectSlug ||
    !context.constraints.projectCapabilities ||
    !tool.requiredCapabilities?.length
  ) {
    return true;
  }

  const caps = context.constraints.projectCapabilities;
  return tool.requiredCapabilities.every(
    (cap: keyof ProjectCapabilities) => caps[cap] === true,
  );
}

function isAllowedBySkills({
  tool,
  context,
  agentMode,
}: {
  tool: ToolConfig<any>;
  context: ServerContext;
  agentMode: boolean;
}): boolean {
  if (agentMode) {
    return true;
  }

  const grantedSkills: Set<Skill> | undefined = context.grantedSkills
    ? new Set<Skill>(context.grantedSkills)
    : undefined;

  if (!grantedSkills) {
    return false;
  }

  return (
    tool.skills.length > 0 && isEnabledBySkills(grantedSkills, tool.skills)
  );
}

function isHiddenByConstraints({
  key,
  context,
}: {
  key: string;
  context: ServerContext;
}): boolean {
  return (
    (key === "find_organizations" && !!context.constraints.organizationSlug) ||
    (key === "find_projects" && !!context.constraints.projectSlug)
  );
}

export function getFilteredInputSchema(
  tool: ToolConfig<any>,
  context: ServerContext,
): Record<string, z.ZodType> {
  const constraintKeysToFilter = new Set(
    getConstraintKeysToFilter(context.constraints, tool.inputSchema),
  );

  return Object.fromEntries(
    Object.entries(tool.inputSchema).filter(
      ([key]) => !constraintKeysToFilter.has(key),
    ),
  ) as Record<string, z.ZodType>;
}

export function injectConstraintParams(
  params: Record<string, unknown>,
  tool: ToolConfig<any>,
  context: ServerContext,
): Record<string, unknown> {
  return {
    ...params,
    ...getConstraintParametersToInject(context.constraints, tool.inputSchema),
  };
}

export function getAvailableTools({
  tools,
  context,
  agentMode = false,
  experimentalMode,
  useDefaultSurfacePolicy,
}: CatalogContext & {
  tools: ToolRegistry;
  agentMode?: boolean;
}): ToolWithContext[] {
  const availableTools: ToolWithContext[] = [];

  for (const [key, tool] of Object.entries(tools)) {
    const placement = getToolPlacement({ key, useDefaultSurfacePolicy });

    if (agentMode) {
      if (key !== "use_sentry") {
        continue;
      }
    } else if (!placement.isCatalogTool && !placement.isTopLevel) {
      continue;
    }

    if (!isToolVisibleInMode(tool, experimentalMode)) {
      continue;
    }

    if (!isAllowedBySkills({ tool, context, agentMode })) {
      continue;
    }

    if (isHiddenByConstraints({ key, context })) {
      continue;
    }

    if (!hasRequiredCapabilities({ tool, context, experimentalMode })) {
      continue;
    }

    availableTools.push({ key, tool, ...placement });
  }

  return availableTools;
}

export function getToolsForMcpRegistration({
  tools,
  context,
  agentMode = false,
  experimentalMode,
  useDefaultSurfacePolicy,
}: CatalogContext & {
  tools: ToolRegistry;
  agentMode?: boolean;
}): ToolWithContext[] {
  const availableTools = getAvailableTools({
    tools,
    context,
    agentMode,
    experimentalMode,
    useDefaultSurfacePolicy,
  });

  if (agentMode) {
    return availableTools;
  }

  return availableTools.filter(({ isTopLevel }) => isTopLevel);
}

export function getSearchableTools({
  tools,
  context,
  experimentalMode,
  useDefaultSurfacePolicy,
}: CatalogContext & {
  tools: ToolRegistry;
}): ToolWithContext[] {
  return getAvailableTools({
    tools,
    context,
    experimentalMode,
    useDefaultSurfacePolicy,
  }).filter(
    ({ key, isCatalogTool }) =>
      isCatalogTool && !isCatalogInfrastructureToolName(key),
  );
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "arguments";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function executeToolHandler({
  tool,
  params,
  context,
}: {
  tool: ToolConfig<any>;
  params: Record<string, unknown>;
  context: ServerContext;
}) {
  const filteredInputSchema = getFilteredInputSchema(tool, context);
  const schema = z.object(filteredInputSchema);
  const parsed = schema.safeParse(params);

  if (!parsed.success) {
    throw new UserInputError(
      `Invalid arguments for ${tool.name}: ${formatZodIssues(parsed.error)}`,
    );
  }

  const paramsWithConstraints = injectConstraintParams(
    parsed.data,
    tool,
    context,
  );

  setTag("catalog.tool", tool.name);

  return tool.handler(paramsWithConstraints as never, context);
}

export function resolveToolDescription(
  tool: ToolConfig<any>,
  experimentalMode: boolean,
): string {
  return resolveDescription(tool.description, { experimentalMode });
}

export type RegisteredToolHandlerExtra = RequestHandlerExtra<
  ServerRequest,
  ServerNotification
>;
