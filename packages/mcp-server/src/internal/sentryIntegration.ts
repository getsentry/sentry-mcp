/**
 * Sentry MCP tool integration utilities for SDK instrumentation.
 *
 * Provides integration with existing Sentry MCP tools like create_project,
 * find_organizations, and find_projects to enable seamless SDK instrumentation
 * workflows that work with the broader Sentry MCP ecosystem.
 */
import { z } from "zod";
import type { ServerContext } from "../types";
import { SentryApiService } from "../api-client/client";
import { UserInputError } from "../errors";

/**
 * Schema for project information extracted from Sentry MCP tools
 */
export const SentryProjectInfoSchema = z.object({
  organizationSlug: z.string(),
  projectSlug: z.string(),
  projectName: z.string().optional(),
  dsn: z.string(),
  platform: z.string().optional(),
  regionUrl: z.string().optional(),
});

export type SentryProjectInfo = z.infer<typeof SentryProjectInfoSchema>;

/**
 * Schema for organization context
 */
export const OrganizationContextSchema = z.object({
  slug: z.string(),
  name: z.string(),
  regionUrl: z.string().optional(),
});

export type OrganizationContext = z.infer<typeof OrganizationContextSchema>;

/**
 * Schema for project selection criteria
 */
export const ProjectSelectionCriteriaSchema = z.object({
  organizationSlug: z.string().optional(),
  projectSlug: z.string().optional(),
  regionUrl: z.string().optional(),
  platform: z.string().optional(),
  createIfNotExists: z.boolean().optional(),
});

export type ProjectSelectionCriteria = z.infer<typeof ProjectSelectionCriteriaSchema>;

/**
 * Utility to create API service from context
 */
function apiServiceFromContext(
  context: ServerContext,
  opts: { regionUrl?: string } = {},
) {
  let host = context.host;

  if (opts.regionUrl) {
    try {
      host = new URL(opts.regionUrl).host;
    } catch (error) {
      throw new UserInputError(
        `Invalid regionUrl provided: ${opts.regionUrl}. Must be a valid URL.`,
      );
    }
  }

  return new SentryApiService({
    host,
    accessToken: context.accessToken,
  });
}

/**
 * Sentry MCP tool integration manager
 */
export class SentryToolIntegration {
  /**
   * Parse DSN and project information from create_project tool output
   */
  static parseCreateProjectOutput(output: string): SentryProjectInfo | null {
    try {
      // Extract key information from structured markdown output
      const lines = output.split('\n');
      
      let organizationSlug = '';
      let projectSlug = '';
      let projectName = '';
      let dsn = '';
      let platform = '';

      // Parse the structured output
      for (const line of lines) {
        if (line.startsWith('# New Project in **') && line.endsWith('**')) {
          organizationSlug = line.match(/\*\*(.*?)\*\*/)?.[1] || '';
        }
        if (line.startsWith('**Slug**: ')) {
          projectSlug = line.replace('**Slug**: ', '').trim();
        }
        if (line.startsWith('**Name**: ')) {
          projectName = line.replace('**Name**: ', '').trim();
        }
        if (line.startsWith('**SENTRY_DSN**: ')) {
          dsn = line.replace('**SENTRY_DSN**: ', '').trim();
        }
        // Platform might not always be in output, but try to extract if present
        if (line.startsWith('**Platform**: ')) {
          platform = line.replace('**Platform**: ', '').trim();
        }
      }

      if (organizationSlug && projectSlug && dsn && dsn !== 'There was an error fetching this value.') {
        return {
          organizationSlug,
          projectSlug,
          projectName: projectName || projectSlug,
          dsn,
          platform: platform || undefined,
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get project information using existing Sentry MCP tools
   */
  static async getProjectInfo(
    context: ServerContext,
    criteria: ProjectSelectionCriteria,
  ): Promise<SentryProjectInfo> {
    const apiService = apiServiceFromContext(context, {
      regionUrl: criteria.regionUrl,
    });

    if (!criteria.organizationSlug) {
      throw new UserInputError(
        "Organization slug is required. Use find_organizations() tool to get available organizations."
      );
    }

    if (!criteria.projectSlug) {
      throw new UserInputError(
        "Project slug is required. Use find_projects() tool to get available projects, or create a new project with create_project() tool."
      );
    }

    // Get project details
    const projects = await apiService.listProjects(criteria.organizationSlug);
    const project = projects.find(p => p.slug === criteria.projectSlug);

    if (!project) {
      throw new UserInputError(
        `Project '${criteria.projectSlug}' not found in organization '${criteria.organizationSlug}'. ` +
        `Use find_projects(organizationSlug="${criteria.organizationSlug}") to see available projects.`
      );
    }

    // Get DSN for the project
    const clientKeys = await apiService.listClientKeys({
      organizationSlug: criteria.organizationSlug,
      projectSlug: criteria.projectSlug,
    });

    const defaultKey = clientKeys.find(key => key.name === "Default") || clientKeys[0];
    
    if (!defaultKey) {
      throw new UserInputError(
        `No DSN found for project '${criteria.projectSlug}'. ` +
        `Use create_dsn(organizationSlug="${criteria.organizationSlug}", projectSlug="${criteria.projectSlug}", name="Default") to create one.`
      );
    }

    return {
      organizationSlug: criteria.organizationSlug,
      projectSlug: criteria.projectSlug,
      projectName: project.name,
      dsn: defaultKey.dsn.public,
      platform: project.platform || criteria.platform,
      regionUrl: criteria.regionUrl,
    };
  }

  /**
   * Get available organizations for user selection
   */
  static async getAvailableOrganizations(
    context: ServerContext,
    regionUrl?: string,
  ): Promise<OrganizationContext[]> {
    const apiService = apiServiceFromContext(context, { regionUrl });
    
    const organizations = await apiService.listOrganizations();
    
    return organizations.map(org => ({
      slug: org.slug,
      name: org.name,
      regionUrl: org.links?.regionUrl,
    }));
  }

  /**
   * Get available projects for a given organization
   */
  static async getAvailableProjects(
    context: ServerContext,
    organizationSlug: string,
    regionUrl?: string,
  ) {
    const apiService = apiServiceFromContext(context, { regionUrl });
    
    const projects = await apiService.listProjects(organizationSlug);
    
    return projects.map(project => ({
      slug: project.slug,
      name: project.name,
      platform: project.platform,
      id: project.id,
    }));
  }

  /**
   * Create instrumentation guidance for tool integration
   */
  static generateToolIntegrationGuidance(
    projectInfo?: SentryProjectInfo,
    hasAmbiguity: boolean = false,
  ): string {
    let guidance = "";

    if (hasAmbiguity) {
      guidance += "## Project Selection Required\n\n";
      guidance += "I need to know which Sentry project to use for instrumentation. You can:\n\n";
      guidance += "1. **Use an existing project**: \n";
      guidance += "   - Run `find_organizations()` to see available organizations\n";
      guidance += "   - Run `find_projects(organizationSlug=\"your-org\")` to see available projects\n";
      guidance += "   - Then specify the project with `organizationSlug` and `projectSlug` parameters\n\n";
      guidance += "2. **Create a new project**:\n";
      guidance += "   - Run `create_project(organizationSlug=\"your-org\", teamSlug=\"your-team\", name=\"your-project\", platform=\"detected-platform\")`\n";
      guidance += "   - I'll automatically use the new project's DSN for instrumentation\n\n";
      return guidance;
    }

    if (projectInfo) {
      guidance += "## Using Sentry Project\n\n";
      guidance += `**Organization**: ${projectInfo.organizationSlug}\n`;
      guidance += `**Project**: ${projectInfo.projectSlug} (${projectInfo.projectName})\n`;
      guidance += `**DSN**: ${projectInfo.dsn}\n`;
      if (projectInfo.platform) {
        guidance += `**Platform**: ${projectInfo.platform}\n`;
      }
      if (projectInfo.regionUrl) {
        guidance += `**Region**: ${projectInfo.regionUrl}\n`;
      }
      guidance += "\n";
      guidance += "This project will be used for SDK instrumentation. The DSN will be automatically configured in your project files.\n\n";
    }

    return guidance;
  }

  /**
   * Validate project compatibility with detected technology stack
   */
  static validateProjectCompatibility(
    projectInfo: SentryProjectInfo,
    detectedLanguage: string,
    detectedFrameworks: string[],
  ): { compatible: boolean; warnings: string[] } {
    const warnings: string[] = [];
    let compatible = true;

    // Check platform compatibility
    if (projectInfo.platform) {
      const projectPlatform = projectInfo.platform.toLowerCase();
      const detectedLang = detectedLanguage.toLowerCase();

      // Basic compatibility mapping
      const compatibilityMap: Record<string, string[]> = {
        javascript: ["javascript", "node", "react", "vue", "angular"],
        typescript: ["javascript", "typescript", "node", "react", "vue", "angular"],
        python: ["python", "django", "flask"],
        go: ["go"],
        java: ["java", "spring"],
        csharp: ["csharp", "dotnet"],
        php: ["php"],
        ruby: ["ruby", "rails"],
      };

      const compatiblePlatforms = compatibilityMap[detectedLang] || [detectedLang];
      
      if (!compatiblePlatforms.some(platform => projectPlatform.includes(platform))) {
        warnings.push(
          `Project platform '${projectInfo.platform}' may not be fully compatible with detected language '${detectedLanguage}'. ` +
          `Consider creating a new project with platform '${detectedLanguage}' for better integration.`
        );
      }
    }

    // Framework-specific warnings
    if (detectedFrameworks.includes('next') && projectInfo.platform !== 'nextjs') {
      warnings.push(
        "Detected Next.js framework but project platform is not 'nextjs'. " +
        "Consider using a Next.js-specific project for optimal configuration."
      );
    }

    return { compatible, warnings };
  }

  /**
   * Format project selection prompt for LLM
   */
  static formatProjectSelectionPrompt(
    organizations: OrganizationContext[],
    projects: any[] = [],
    selectedOrgSlug?: string,
  ): string {
    let prompt = "## Available Sentry Resources\n\n";

    if (organizations.length === 0) {
      return "No Sentry organizations found. Please check your access token and permissions.";
    }

    if (!selectedOrgSlug) {
      prompt += "**Organizations:**\n\n";
      organizations.forEach((org, index) => {
        prompt += `${index + 1}. **${org.name}** (${org.slug})`;
        if (org.regionUrl) {
          prompt += ` - ${org.regionUrl}`;
        }
        prompt += "\n";
      });
      prompt += "\nPlease specify which organization to use with the `organizationSlug` parameter.\n\n";
    } else {
      const selectedOrg = organizations.find(org => org.slug === selectedOrgSlug);
      prompt += `**Selected Organization**: ${selectedOrg?.name || selectedOrgSlug}\n\n`;

      if (projects.length > 0) {
        prompt += "**Available Projects:**\n\n";
        projects.forEach((project, index) => {
          prompt += `${index + 1}. **${project.name}** (${project.slug})`;
          if (project.platform) {
            prompt += ` - ${project.platform}`;
          }
          prompt += "\n";
        });
        prompt += "\nYou can either:\n";
        prompt += "- Use an existing project by specifying `projectSlug`\n";
        prompt += "- Create a new project using the `create_project()` tool\n\n";
      } else {
        prompt += "No projects found in this organization.\n";
        prompt += "Use the `create_project()` tool to create a new project first.\n\n";
      }
    }

    return prompt;
  }
} 
