/**
 * File modification utilities for Sentry SDK instrumentation.
 *
 * Provides utilities for environment variable configuration, file validation,
 * and safe file operations to complement the dependency management system.
 */
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { FileSystemUtils } from "./projectDetection";

/**
 * Schema for environment variable configuration
 */
export const EnvironmentConfigSchema = z.object({
  dsn: z.string(),
  environment: z.string().optional(),
  tracesSampleRate: z.number().optional(),
  debug: z.boolean().optional(),
  customVariables: z.record(z.string()).optional(),
});

export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;

/**
 * Schema for file validation result
 */
export const FileValidationResultSchema = z.object({
  isValid: z.boolean(),
  filePath: z.string(),
  fileType: z.enum(["json", "toml", "xml", "go", "python", "javascript", "typescript", "text"]),
  errors: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

export type FileValidationResult = z.infer<typeof FileValidationResultSchema>;

/**
 * Environment variable file manager
 */
export class EnvironmentVariableManager {
  /**
   * Create or update .env file with Sentry configuration
   */
  static async setupEnvironmentFile(
    projectRoot: string,
    config: EnvironmentConfig,
    envFileName: string = ".env.local",
  ): Promise<string> {
    const envFilePath = path.join(projectRoot, envFileName);
    
    // Generate environment variables content
    const envLines = [
      "# Sentry Configuration",
      `SENTRY_DSN=${config.dsn}`,
    ];

    if (config.environment) {
      envLines.push(`SENTRY_ENVIRONMENT=${config.environment}`);
    }

    if (config.tracesSampleRate !== undefined) {
      envLines.push(`SENTRY_TRACES_SAMPLE_RATE=${config.tracesSampleRate}`);
    }

    if (config.debug !== undefined) {
      envLines.push(`SENTRY_DEBUG=${config.debug}`);
    }

    // Add custom variables
    if (config.customVariables) {
      envLines.push("", "# Custom Sentry Variables");
      for (const [key, value] of Object.entries(config.customVariables)) {
        envLines.push(`${key}=${value}`);
      }
    }

    let existingContent = "";
    let sentryConfigExists = false;

    // Check if file exists and read content
    if (await FileSystemUtils.fileExists(envFilePath)) {
      existingContent = await fs.readFile(envFilePath, "utf-8");
      sentryConfigExists = existingContent.includes("SENTRY_DSN");
    }

    if (sentryConfigExists) {
      // Update existing Sentry configuration
      const lines = existingContent.split("\n");
      const updatedLines: string[] = [];
      let inSentrySection = false;
      let sentryConfigUpdated = false;

      for (const line of lines) {
        if (line.trim() === "# Sentry Configuration") {
          inSentrySection = true;
          updatedLines.push(...envLines);
          sentryConfigUpdated = true;
          continue;
        }

        if (inSentrySection && (line.startsWith("SENTRY_") || line.trim() === "")) {
          // Skip old Sentry configuration lines
          if (line.trim() === "" && !line.startsWith("SENTRY_")) {
            inSentrySection = false;
            updatedLines.push(line);
          }
          continue;
        }

        inSentrySection = false;
        updatedLines.push(line);
      }

      // If we didn't find and update a Sentry section, append it
      if (!sentryConfigUpdated) {
        updatedLines.push("", ...envLines);
      }

      await fs.writeFile(envFilePath, updatedLines.join("\n"), "utf-8");
    } else {
      // Append to existing file or create new file
      const newContent = existingContent
        ? `${existingContent}\n\n${envLines.join("\n")}\n`
        : `${envLines.join("\n")}\n`;
      
      await fs.writeFile(envFilePath, newContent, "utf-8");
    }

    return envFilePath;
  }

  /**
   * Generate environment variable configuration for different frameworks
   */
  static generateFrameworkEnvSetup(
    framework: string,
    config: EnvironmentConfig,
  ): { instructions: string; files: string[] } {
    const files: string[] = [];
    let instructions = "";

    switch (framework.toLowerCase()) {
      case "next":
      case "nextjs":
        files.push(".env.local");
        instructions = `## Environment Variables for Next.js

Add the following to your \`.env.local\` file:

\`\`\`bash
SENTRY_DSN=${config.dsn}
SENTRY_ENVIRONMENT=${config.environment || "production"}
\`\`\`

Next.js will automatically load these variables for both client and server-side code.`;
        break;

      case "react":
        files.push(".env", ".env.local");
        instructions = `## Environment Variables for React

Add the following to your \`.env\` file:

\`\`\`bash
REACT_APP_SENTRY_DSN=${config.dsn}
REACT_APP_SENTRY_ENVIRONMENT=${config.environment || "production"}
\`\`\`

**Note**: In React, environment variables must be prefixed with \`REACT_APP_\` to be accessible in the browser.`;
        break;

      case "django":
        files.push(".env", "settings.py");
        instructions = `## Environment Variables for Django

Add the following to your environment or \`.env\` file:

\`\`\`bash
SENTRY_DSN=${config.dsn}
SENTRY_ENVIRONMENT=${config.environment || "production"}
DEBUG=False
\`\`\`

Update your \`settings.py\` to read these variables:

\`\`\`python
import os
from django.core.exceptions import ImproperlyConfigured

def get_env_variable(var_name):
    try:
        return os.environ[var_name]
    except KeyError:
        error_msg = f"Set the {var_name} environment variable"
        raise ImproperlyConfigured(error_msg)

SENTRY_DSN = get_env_variable('SENTRY_DSN')
SENTRY_ENVIRONMENT = get_env_variable('SENTRY_ENVIRONMENT')
\`\`\``;
        break;

      case "flask":
        files.push(".env", ".flaskenv");
        instructions = `## Environment Variables for Flask

Add the following to your \`.env\` file:

\`\`\`bash
SENTRY_DSN=${config.dsn}
SENTRY_ENVIRONMENT=${config.environment || "production"}
FLASK_ENV=production
\`\`\`

Access these in your Flask app:

\`\`\`python
import os
from flask import Flask

app = Flask(__name__)

# Load environment variables
SENTRY_DSN = os.environ.get('SENTRY_DSN')
SENTRY_ENVIRONMENT = os.environ.get('SENTRY_ENVIRONMENT', 'production')
\`\`\``;
        break;

      case "go":
      case "gin":
        files.push(".env");
        instructions = `## Environment Variables for Go

Set the following environment variables:

\`\`\`bash
export SENTRY_DSN="${config.dsn}"
export SENTRY_ENVIRONMENT="${config.environment || "production"}"
\`\`\`

Or add to a \`.env\` file and load with a library like \`godotenv\`:

\`\`\`go
import "github.com/joho/godotenv"

func init() {
    err := godotenv.Load()
    if err != nil {
        log.Fatal("Error loading .env file")
    }
}
\`\`\``;
        break;

      case "spring":
      case "springboot":
        files.push("application.properties", "application.yml");
        instructions = `## Environment Variables for Spring Boot

Add to your \`application.properties\`:

\`\`\`properties
sentry.dsn=\${SENTRY_DSN:${config.dsn}}
sentry.environment=\${SENTRY_ENVIRONMENT:${config.environment || "production"}}
\`\`\`

Set environment variables:

\`\`\`bash
export SENTRY_DSN="${config.dsn}"
export SENTRY_ENVIRONMENT="${config.environment || "production"}"
\`\`\``;
        break;

      default:
        files.push(".env");
        instructions = `## Environment Variables

Set the following environment variables:

\`\`\`bash
export SENTRY_DSN="${config.dsn}"
export SENTRY_ENVIRONMENT="${config.environment || "production"}"
\`\`\``;
    }

    return { instructions, files };
  }
}

/**
 * File validation utilities
 */
export class FileValidator {
  /**
   * Validate JSON file syntax
   */
  static async validateJsonFile(filePath: string): Promise<FileValidationResult> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      JSON.parse(content);
      
      return {
        isValid: true,
        filePath,
        fileType: "json",
      };
    } catch (error) {
      return {
        isValid: false,
        filePath,
        fileType: "json",
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate XML file syntax (basic)
   */
  static async validateXmlFile(filePath: string): Promise<FileValidationResult> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      
      // Basic XML validation - check for balanced tags
      const openTags = content.match(/<[^/!?][^>]*>/g) || [];
      const closeTags = content.match(/<\/[^>]+>/g) || [];
      
      const warnings: string[] = [];
      
      // Simple validation - this could be enhanced with a proper XML parser
      if (openTags.length !== closeTags.length) {
        warnings.push("Potential tag mismatch detected");
      }
      
      return {
        isValid: true,
        filePath,
        fileType: "xml",
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        isValid: false,
        filePath,
        fileType: "xml",
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate Python file syntax (basic)
   */
  static async validatePythonFile(filePath: string): Promise<FileValidationResult> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      
      // Basic Python validation - check indentation and basic syntax
      const lines = content.split("\n");
      const errors: string[] = [];
      const warnings: string[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        
        // Check for common syntax issues
        if (line.trim().endsWith(":") && i < lines.length - 1) {
          const nextLine = lines[i + 1];
          if (nextLine.trim() && !nextLine.startsWith(" ") && !nextLine.startsWith("\t")) {
            warnings.push(`Line ${lineNum}: Expected indentation after ':' statement`);
          }
        }
        
        // Check for unmatched brackets
        const openBrackets = (line.match(/[\(\[\{]/g) || []).length;
        const closeBrackets = (line.match(/[\)\]\}]/g) || []).length;
        if (openBrackets !== closeBrackets) {
          warnings.push(`Line ${lineNum}: Potential bracket mismatch`);
        }
      }
      
      return {
        isValid: errors.length === 0,
        filePath,
        fileType: "python",
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        isValid: false,
        filePath,
        fileType: "python",
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate Go file syntax (basic)
   */
  static async validateGoFile(filePath: string): Promise<FileValidationResult> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      
      const warnings: string[] = [];
      
      // Basic Go validation
      if (!content.includes("package ")) {
        warnings.push("No package declaration found");
      }
      
      // Check for balanced braces
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      
      if (openBraces !== closeBraces) {
        warnings.push("Potential brace mismatch detected");
      }
      
      return {
        isValid: true,
        filePath,
        fileType: "go",
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        isValid: false,
        filePath,
        fileType: "go",
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Auto-detect file type and validate accordingly
   */
  static async validateFile(filePath: string): Promise<FileValidationResult> {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case ".json":
        return this.validateJsonFile(filePath);
      case ".xml":
        return this.validateXmlFile(filePath);
      case ".py":
        return this.validatePythonFile(filePath);
      case ".go":
        return this.validateGoFile(filePath);
      case ".js":
      case ".ts":
      case ".jsx":
      case ".tsx":
        // For JavaScript/TypeScript, we'll do basic validation
        return {
          isValid: true,
          filePath,
          fileType: ext.includes("ts") ? "typescript" : "javascript",
          warnings: ["JavaScript/TypeScript validation not fully implemented"],
        };
      default:
        return {
          isValid: true,
          filePath,
          fileType: "text",
          warnings: ["File type validation not available for this extension"],
        };
    }
  }

  /**
   * Validate multiple files
   */
  static async validateFiles(filePaths: string[]): Promise<FileValidationResult[]> {
    const results = await Promise.allSettled(
      filePaths.map(filePath => this.validateFile(filePath))
    );

    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          isValid: false,
          filePath: filePaths[index],
          fileType: "text" as const,
          errors: [result.reason?.message || "Validation failed"],
        };
      }
    });
  }
} 
