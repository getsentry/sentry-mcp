/**
 * Prompt implementation handlers for the Sentry MCP server.
 *
 * Contains runtime implementations for all MCP prompts defined in `promptDefinitions.ts`.
 * Each handler generates context-aware instructions that guide LLMs through
 * complex multi-step workflows involving Sentry operations.
 *
 * @example Basic Handler Pattern
 * ```typescript
 * prompt_name: async (context, params) => {
 *   const instructions = [
 *     "Primary objective and context",
 *     "",
 *     "1. First step with specific tool call",
 *     "2. Second step with conditional logic",
 *     "3. Final step with recommendations",
 *   ];
 *   return instructions.join("\n");
 * },
 * ```
 */
import { UserInputError } from "./errors";
import type { PromptHandlers } from "./types";
import { 
  detectProjectWithAmbiguityCheck, 
  generateAmbiguityPrompt,
  type ProjectDetectionResult 
} from "./internal/projectDetection";
import { 
  SdkContextClient, 
  type SdkContext 
} from "./internal/sdkContextClient";
import { 
  SdkInstrumentationOrchestrator,
  type InstrumentationConfig 
} from "./internal/sdkInstrumentation";
import { 
  SentryToolIntegration,
  type SentryProjectInfo 
} from "./internal/sentryIntegration";

export const PROMPT_HANDLERS = {
  find_errors_in_file: async (context, { organizationSlug, filename }) =>
    [
      `I want to find errors in Sentry, within the organization ${organizationSlug}, for the file ${filename}`,
      "",
      "You should use the tool `search_errors` to find errors in Sentry.",
      "",
      "If the filename is ambiguous, such as something like `index.ts`, and in most cases, you should pass it in with its direct parent.",
      "For example: if the file is `app/utils/index.ts`, you should pass in `utils/index.ts` or `app/utils/index.ts` depending on if the file is actually part of the applications source path.",
    ].join("\n"),
  fix_issue_with_seer: async (
    context,
    { organizationSlug, issueId, issueUrl },
  ) => {
    let issueMessage: string;
    if (issueUrl) {
      issueMessage = `The Sentry issue is ${issueUrl}`;
    } else if (organizationSlug && issueId) {
      issueMessage = `The Sentry issue is ${issueId} in the organization ${organizationSlug}`;
    } else {
      throw new UserInputError(
        "Either issueUrl or organizationSlug and issueId must be provided",
      );
    }
    return [
      `I want to use Seer to fix an issue in Sentry.`,
      "",
      issueMessage,
      "",
      "1. Call the tool `get_seer_issue_fix_status` to see if its already in progress.",
      "2a. If it isn't, you can start it with the tool `begin_seer_issue_fix`.",
      "2b. If it is, you can call the tool `get_seer_issue_fix_status` to check the status of the analysis.",
      "3. Repeat step 2b until the task has completed.",
      "4. Help me apply the fix to my application, if you are able to. Think carefully when doing this.",
    ].join("\n");
  },
  setup_sentry_instrumentation: async (
    context,
    { organizationSlug, projectSlug, targetDirectory },
  ) => {
    const instructions: string[] = [
      "I'll help you set up Sentry SDK instrumentation for your project. This involves detecting your project type, selecting a Sentry project, and configuring the appropriate SDK.",
      "",
      "## Workflow Overview",
      "",
      "1. **Detect Project Type**: Analyze your project to determine language and framework",
      "2. **Select Sentry Project**: Choose or create a Sentry project for error tracking", 
      "3. **Fetch SDK Context**: Get up-to-date SDK configuration guidelines",
      "4. **Generate Instrumentation Plan**: Create step-by-step setup instructions",
      "5. **Apply Configuration**: Install dependencies and configure SDK",
      "",
    ];

    try {
      // Step 1: Detect project type and handle ambiguity
      instructions.push("## Step 1: Project Detection");
      instructions.push("");
      
      const { results: detectionResults, ambiguity } = await detectProjectWithAmbiguityCheck(targetDirectory);
      
      if (ambiguity.hasAmbiguity) {
        instructions.push("⚠️  **Project Detection Issue Detected**");
        instructions.push("");
        instructions.push(generateAmbiguityPrompt(ambiguity));
        instructions.push("");
        instructions.push("**Next Steps:**");
        instructions.push("- Review the detected options above");
        instructions.push("- Specify your preferred language/framework by providing additional context");
        instructions.push("- Then re-run this prompt with more specific parameters");
        instructions.push("");
        return instructions.join("\n");
      }

      if (detectionResults.length === 0) {
        instructions.push("❌ **No supported project detected**");
        instructions.push("");
        instructions.push("I couldn't detect a supported project type in the current directory.");
        instructions.push("");
        instructions.push("**Supported Technologies:**");
        instructions.push("- **JavaScript/TypeScript**: React, Next.js, Vue, Angular, Node.js");
        instructions.push("- **Python**: Django, Flask, FastAPI");
        instructions.push("- **Go**: Gin, Echo, standard library");
        instructions.push("- **Java**: Spring Boot, Maven projects");
        instructions.push("- **Rust**: Cargo-based projects");
        instructions.push("");
        instructions.push("**Next Steps:**");
        instructions.push("1. Navigate to your project directory");
        instructions.push("2. Ensure you have the appropriate dependency files (package.json, requirements.txt, go.mod, etc.)");
        instructions.push("3. Re-run this prompt from the correct directory");
        instructions.push("");
        return instructions.join("\n");
      }

      const primaryDetection = detectionResults[0];
      instructions.push(`✅ **Detected: ${primaryDetection.language}** project`);
      
      if (primaryDetection.frameworks.length > 0) {
        instructions.push(`   **Frameworks**: ${primaryDetection.frameworks.join(", ")}`);
      }
      
      instructions.push(`   **Confidence**: ${Math.round(primaryDetection.confidence * 100)}%`);
      instructions.push(`   **Root**: ${primaryDetection.projectRoot}`);
      instructions.push(`   **Files**: ${primaryDetection.detectedFiles.join(", ")}`);
      instructions.push("");

      // Step 2: Handle Sentry project selection
      instructions.push("## Step 2: Sentry Project Selection");
      instructions.push("");

      let projectInfo: SentryProjectInfo | undefined;

      if (organizationSlug && projectSlug) {
        // Try to get project info directly
        try {
          projectInfo = await SentryToolIntegration.getProjectInfo(context, {
            organizationSlug,
            projectSlug,
            platform: primaryDetection.language,
          });
          
          // Validate compatibility
          const compatibility = SentryToolIntegration.validateProjectCompatibility(
            projectInfo,
            primaryDetection.language,
            primaryDetection.frameworks,
          );
          
          instructions.push(`✅ **Using Sentry Project**: ${projectInfo.organizationSlug}/${projectInfo.projectSlug}`);
          instructions.push(`   **DSN**: ${projectInfo.dsn}`);
          
          if (compatibility.warnings.length > 0) {
            instructions.push("");
            instructions.push("⚠️  **Compatibility Warnings:**");
            compatibility.warnings.forEach(warning => {
              instructions.push(`   - ${warning}`);
            });
          }
          instructions.push("");
          
        } catch (error) {
          instructions.push(`❌ **Project Access Error**: ${error instanceof Error ? error.message : String(error)}`);
          instructions.push("");
          instructions.push("**Next Steps:**");
          instructions.push("1. Verify the organization and project slugs are correct");
          instructions.push("2. Use `find_organizations()` to see available organizations");
          instructions.push("3. Use `find_projects(organizationSlug=\"your-org\")` to see available projects");
          instructions.push("4. Or create a new project with `create_project()` tool");
          instructions.push("");
          return instructions.join("\n");
        }
      } else {
        // Guide user to select or create project
        instructions.push("🔍 **Project Selection Required**");
        instructions.push("");
        instructions.push(SentryToolIntegration.generateToolIntegrationGuidance(undefined, true));
        
        if (organizationSlug) {
          try {
            const projects = await SentryToolIntegration.getAvailableProjects(context, organizationSlug);
            const organizations = await SentryToolIntegration.getAvailableOrganizations(context);
            
            instructions.push(SentryToolIntegration.formatProjectSelectionPrompt(
              organizations,
              projects,
              organizationSlug
            ));
          } catch (error) {
            instructions.push(`Error fetching projects: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          try {
            const organizations = await SentryToolIntegration.getAvailableOrganizations(context);
            instructions.push(SentryToolIntegration.formatProjectSelectionPrompt(organizations));
          } catch (error) {
            instructions.push(`Error fetching organizations: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        
        instructions.push("");
        instructions.push("**Once you have the project details, re-run this prompt with:**");
        instructions.push("```");
        instructions.push(`setup_sentry_instrumentation(organizationSlug="your-org", projectSlug="your-project")`);
        instructions.push("```");
        instructions.push("");
        return instructions.join("\n");
      }

      // Step 3: Fetch SDK context (if we have project info)
      if (projectInfo) {
        instructions.push("## Step 3: SDK Context & Configuration");
        instructions.push("");

        try {
          const sdkIdentifier = SdkInstrumentationOrchestrator.generateSdkIdentifier(primaryDetection);
          const sdkContextClient = new SdkContextClient();
          
          instructions.push(`🔄 **Fetching SDK guidelines for**: ${sdkIdentifier}`);
          
          const sdkContext = await sdkContextClient.fetchSdkContext({
            sdk: sdkIdentifier,
            version: "latest",
            fallbackToBuiltIn: true,
          });
          
          instructions.push(`✅ **SDK context loaded** (source: ${sdkContext.source})`);
          instructions.push("");

          // Step 4: Generate instrumentation plan
          instructions.push("## Step 4: Instrumentation Plan");
          instructions.push("");

          const instrumentationConfig: InstrumentationConfig = {
            dsn: projectInfo.dsn,
            environment: "production",
            tracesSampleRate: 1.0,
            enablePerformance: true,
            organizationSlug: projectInfo.organizationSlug,
            projectSlug: projectInfo.projectSlug,
          };

          const plan = SdkInstrumentationOrchestrator.generateInstrumentationPlan(
            primaryDetection,
            instrumentationConfig,
            sdkContext,
          );

          instructions.push(`📋 **Instrumentation Plan for ${plan.language}${plan.framework ? ` (${plan.framework})` : ""}**`);
          instructions.push("");
          
          // Dependencies
          if (plan.dependencies.length > 0) {
            instructions.push("### Dependencies to Install");
            instructions.push("");
            plan.dependencies.forEach((dep, index) => {
              instructions.push(`${index + 1}. **${dep.manager}**: \`${dep.command}\``);
              instructions.push(`   Packages: ${dep.packages.join(", ")}`);
            });
            instructions.push("");
          }

          // File modifications
          if (plan.fileModifications.length > 0) {
            instructions.push("### Files to Create/Modify");
            instructions.push("");
            plan.fileModifications.forEach((mod, index) => {
              instructions.push(`${index + 1}. **${mod.operation}** \`${mod.filePath}\``);
              instructions.push(`   ${mod.description}`);
            });
            instructions.push("");
          }

          // Step 5: Execution guidance
          instructions.push("## Step 5: Implementation");
          instructions.push("");
          
          instructions.push("### 🚀 **Ready to Apply Configuration**");
          instructions.push("");
          instructions.push("The instrumentation plan is ready. Here's what will happen:");
          instructions.push("");
          
          instructions.push("1. **Backup existing files** (automatic)");
          instructions.push("2. **Install Sentry dependencies**");
          instructions.push("3. **Create/modify configuration files**");
          instructions.push("4. **Set up environment variables**");
          instructions.push("5. **Validate configuration**");
          instructions.push("");
          
          instructions.push("### 📝 **Manual Steps Required**");
          instructions.push("");
          
          if (plan.dependencies.length > 0) {
            instructions.push("**Install Dependencies:**");
            plan.dependencies.forEach(dep => {
              instructions.push(`\`\`\`bash`);
              instructions.push(dep.command);
              instructions.push(`\`\`\``);
            });
            instructions.push("");
          }
          
          if (plan.fileModifications.length > 0) {
            instructions.push("**File Modifications:**");
            instructions.push("");
            plan.fileModifications.forEach(mod => {
              instructions.push(`**${mod.filePath}** (${mod.operation}):`);
              instructions.push("```" + (mod.filePath.endsWith('.py') ? 'python' : 
                              mod.filePath.endsWith('.go') ? 'go' :
                              mod.filePath.endsWith('.java') ? 'java' :
                              mod.filePath.endsWith('.xml') ? 'xml' : 'javascript'));
              instructions.push(mod.content);
              instructions.push("```");
              instructions.push("");
            });
          }

          // Post-installation steps
          if (plan.postInstallSteps.length > 0) {
            instructions.push("### ✅ **After Installation**");
            instructions.push("");
            plan.postInstallSteps.forEach((step, index) => {
              instructions.push(`${index + 1}. ${step}`);
            });
            instructions.push("");
          }

          // Verification steps
          if (plan.verificationSteps.length > 0) {
            instructions.push("### 🔍 **Verification**");
            instructions.push("");
            plan.verificationSteps.forEach((step, index) => {
              instructions.push(`${index + 1}. ${step}`);
            });
            instructions.push("");
          }

          // Custom instructions from SDK context
          if (plan.instructions) {
            instructions.push("### 📚 **Additional SDK Information**");
            instructions.push("");
            instructions.push(plan.instructions);
            instructions.push("");
          }

          // Final guidance
          instructions.push("## 🎉 **Next Steps**");
          instructions.push("");
          instructions.push("1. **Review the plan above** and ensure you understand the changes");
          instructions.push("2. **Run the dependency installation commands** in your terminal");
          instructions.push("3. **Apply the file modifications** shown above");
          instructions.push("4. **Test your application** to ensure Sentry is working correctly");
          instructions.push("5. **Check your Sentry dashboard** for incoming events");
          instructions.push("");
          
          instructions.push("### 🔗 **Useful Links**");
          instructions.push("");
          instructions.push(`- **Sentry Project**: https://${projectInfo.organizationSlug}.sentry.io/projects/${projectInfo.projectSlug}/`);
          instructions.push(`- **Issues Dashboard**: https://${projectInfo.organizationSlug}.sentry.io/issues/`);
          instructions.push(`- **Performance**: https://${projectInfo.organizationSlug}.sentry.io/performance/`);
          instructions.push("");
          
          instructions.push("### 💡 **Pro Tips**");
          instructions.push("");
          instructions.push("- **Test error reporting**: Add a deliberate error to verify Sentry is capturing issues");
          instructions.push("- **Monitor performance**: Check the Performance tab in Sentry for transaction traces");
          instructions.push("- **Set up alerts**: Configure alert rules for important errors in your Sentry project");
          instructions.push("- **Custom releases**: Use Sentry releases to track deployments and regressions");

        } catch (error) {
          instructions.push(`❌ **SDK Context Error**: ${error instanceof Error ? error.message : String(error)}`);
          instructions.push("");
          instructions.push("Falling back to basic instrumentation without enhanced context.");
          instructions.push("");
          
          // Provide basic setup instructions as fallback
          instructions.push("### 🔧 **Basic Setup Instructions**");
          instructions.push("");
          instructions.push(`1. Install the Sentry SDK for ${primaryDetection.language}`);
          instructions.push(`2. Initialize Sentry with DSN: \`${projectInfo.dsn}\``);
          instructions.push("3. Test error reporting with a sample error");
          instructions.push("");
        }
      }

    } catch (error) {
      instructions.push("❌ **Unexpected Error**");
      instructions.push("");
      instructions.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
      instructions.push("");
      instructions.push("**Fallback Options:**");
      instructions.push("1. Try running individual Sentry MCP tools manually:");
      instructions.push("   - `find_organizations()` to see available organizations");
      instructions.push("   - `find_projects(organizationSlug=\"your-org\")` to see projects");
      instructions.push("   - `create_project()` to create a new project");
      instructions.push("2. Check that your access token has the required permissions");
      instructions.push("3. Verify you're in the correct project directory");
    }

    return instructions.join("\n");
  },
} satisfies PromptHandlers;
