/**
 * SDK instrumentation utilities for applying Sentry setup to detected projects.
 *
 * Provides language and framework-specific configuration templates, dependency
 * management, and initialization code generation. Integrates with project
 * detection and SDK context fetching for comprehensive instrumentation.
 */
import { z } from "zod";
import * as path from "path";
import type { ProjectDetectionResult } from "./projectDetection";
import type { SdkContext } from "./sdkContextClient";

/**
 * Schema for instrumentation configuration
 */
export const InstrumentationConfigSchema = z.object({
  dsn: z.string(),
  environment: z.string().optional(),
  projectSlug: z.string().optional(),
  organizationSlug: z.string().optional(),
  tracesSampleRate: z.number().min(0).max(1).optional(),
  enablePerformance: z.boolean().optional(),
  enableErrorBoundaries: z.boolean().optional(),
});

export type InstrumentationConfig = z.infer<typeof InstrumentationConfigSchema>;

/**
 * Schema for file modifications
 */
export const FileModificationSchema = z.object({
  filePath: z.string(),
  operation: z.enum(["create", "modify", "append"]),
  content: z.string(),
  description: z.string(),
  backup: z.boolean().optional(),
});

export type FileModification = z.infer<typeof FileModificationSchema>;

/**
 * Schema for dependency installation
 */
export const DependencyInstallationSchema = z.object({
  manager: z.enum(["npm", "yarn", "pnpm", "pip", "poetry", "go", "maven", "gradle", "nuget", "composer", "bundle"]),
  command: z.string(),
  packages: z.array(z.string()),
  devDependencies: z.boolean().optional(),
});

export type DependencyInstallation = z.infer<typeof DependencyInstallationSchema>;

/**
 * Schema for complete instrumentation plan
 */
export const InstrumentationPlanSchema = z.object({
  language: z.string(),
  framework: z.string().optional(),
  dependencies: z.array(DependencyInstallationSchema),
  fileModifications: z.array(FileModificationSchema),
  instructions: z.string(),
  postInstallSteps: z.array(z.string()),
  verificationSteps: z.array(z.string()),
});

export type InstrumentationPlan = z.infer<typeof InstrumentationPlanSchema>;

/**
 * SDK-specific configuration templates
 */
export class SdkInstrumentationTemplates {
  /**
   * Generate React SDK instrumentation
   */
  static generateReactInstrumentation(
    config: InstrumentationConfig,
    projectRoot: string,
    context?: SdkContext,
  ): InstrumentationPlan {
    const { dsn, environment = "production", tracesSampleRate = 1.0, enablePerformance = true } = config;

    // Check for Next.js vs standard React
    const isNextJs = context?.content.toLowerCase().includes("next") ?? false;

    const dependencies: DependencyInstallation[] = [
      {
        manager: "npm",
        command: "npm install @sentry/react",
        packages: ["@sentry/react"],
      },
    ];

    const fileModifications: FileModification[] = [];

    if (isNextJs) {
      // Next.js configuration
      fileModifications.push({
        filePath: path.join(projectRoot, "sentry.client.config.ts"),
        operation: "create",
        content: `import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "${dsn}",
  environment: "${environment}",
  tracesSampleRate: ${tracesSampleRate},
  debug: false,
  integrations: [
    Sentry.browserTracingIntegration({
      // Set tracing origins to connect traces
      tracePropagationTargets: ["localhost", /^https:\\/\\/yourserver\\//],
    }),
  ],
});
`,
        description: "Next.js client-side Sentry configuration",
      });

      fileModifications.push({
        filePath: path.join(projectRoot, "sentry.server.config.ts"),
        operation: "create",
        content: `import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "${dsn}",
  environment: "${environment}",
  tracesSampleRate: ${tracesSampleRate},
  debug: false,
});
`,
        description: "Next.js server-side Sentry configuration",
      });
    } else {
      // Standard React configuration
      fileModifications.push({
        filePath: path.join(projectRoot, "src/sentry.ts"),
        operation: "create",
        content: `import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "${dsn}",
  environment: "${environment}",
  tracesSampleRate: ${tracesSampleRate},
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
});
`,
        description: "React Sentry initialization",
      });

      // Add import to main app file
      fileModifications.push({
        filePath: path.join(projectRoot, "src/index.tsx"),
        operation: "modify",
        content: `import "./sentry";
// ... existing imports`,
        description: "Import Sentry configuration in main app file",
      });
    }

    return {
      language: "javascript",
      framework: isNextJs ? "next" : "react",
      dependencies,
      fileModifications,
      instructions: `# React/Next.js Sentry Instrumentation

${context?.content || "Using built-in React SDK configuration."}

## Environment Variables

Add the following to your \`.env.local\` file:

\`\`\`
SENTRY_DSN=${dsn}
SENTRY_ENVIRONMENT=${environment}
\`\`\``,
      postInstallSteps: [
        "Restart your development server",
        "Test error reporting by throwing a test error",
        isNextJs ? "Deploy to test production error reporting" : "Build and test production bundle",
      ],
      verificationSteps: [
        "Check that Sentry is initialized without errors in browser console",
        "Verify performance monitoring is active in Sentry dashboard",
        "Test error boundary functionality",
      ],
    };
  }

  /**
   * Generate Python Django SDK instrumentation
   */
  static generateDjangoInstrumentation(
    config: InstrumentationConfig,
    projectRoot: string,
    context?: SdkContext,
  ): InstrumentationPlan {
    const { dsn, environment = "production", tracesSampleRate = 1.0 } = config;

    const dependencies: DependencyInstallation[] = [
      {
        manager: "pip",
        command: "pip install sentry-sdk[django]",
        packages: ["sentry-sdk[django]"],
      },
    ];

    const fileModifications: FileModification[] = [
      {
        filePath: path.join(projectRoot, "sentry_config.py"),
        operation: "create",
        content: `import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration
import os

def init_sentry():
    sentry_sdk.init(
        dsn="${dsn}",
        environment="${environment}",
        traces_sample_rate=${tracesSampleRate},
        send_default_pii=True,
        integrations=[
            DjangoIntegration(
                transaction_style="url",
                middleware_spans=True,
                signals_spans=True,
            ),
        ],
    )
`,
        description: "Django Sentry configuration module",
      },
      {
        filePath: path.join(projectRoot, "settings.py"),
        operation: "modify",
        content: `# Add at the top of settings.py
import os
from .sentry_config import init_sentry

# Initialize Sentry
if not DEBUG:
    init_sentry()

# ... rest of your settings`,
        description: "Import and initialize Sentry in Django settings",
      },
    ];

    return {
      language: "python",
      framework: "django",
      dependencies,
      fileModifications,
      instructions: `# Django Sentry Instrumentation

${context?.content || "Using built-in Django SDK configuration."}

## Environment Variables

Add the following to your environment:

\`\`\`bash
export SENTRY_DSN="${dsn}"
export SENTRY_ENVIRONMENT="${environment}"
\`\`\`

Or add to your \`.env\` file if using django-environ.`,
      postInstallSteps: [
        "Run python manage.py runserver to test configuration",
        "Create a test view that raises an exception",
        "Test in production environment",
      ],
      verificationSteps: [
        "Check Django startup logs for Sentry initialization",
        "Verify database queries are being traced",
        "Test exception reporting with a deliberate error",
      ],
    };
  }

  /**
   * Generate Python Flask SDK instrumentation
   */
  static generateFlaskInstrumentation(
    config: InstrumentationConfig,
    projectRoot: string,
    context?: SdkContext,
  ): InstrumentationPlan {
    const { dsn, environment = "production", tracesSampleRate = 1.0 } = config;

    const dependencies: DependencyInstallation[] = [
      {
        manager: "pip",
        command: "pip install sentry-sdk[flask]",
        packages: ["sentry-sdk[flask]"],
      },
    ];

    const fileModifications: FileModification[] = [
      {
        filePath: path.join(projectRoot, "app.py"),
        operation: "modify",
        content: `import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration
from flask import Flask

# Initialize Sentry
sentry_sdk.init(
    dsn="${dsn}",
    environment="${environment}",
    traces_sample_rate=${tracesSampleRate},
    integrations=[
        FlaskIntegration(transaction_style="url"),
    ],
)

app = Flask(__name__)

# ... rest of your Flask app`,
        description: "Add Sentry initialization to Flask app",
      },
    ];

    return {
      language: "python",
      framework: "flask",
      dependencies,
      fileModifications,
      instructions: `# Flask Sentry Instrumentation

${context?.content || "Using built-in Flask SDK configuration."}

## Environment Variables

Set the following environment variables:

\`\`\`bash
export SENTRY_DSN="${dsn}"
export SENTRY_ENVIRONMENT="${environment}"
\`\`\``,
      postInstallSteps: [
        "Start your Flask development server",
        "Create a test route that raises an exception",
        "Test error reporting",
      ],
      verificationSteps: [
        "Check Flask startup logs for Sentry initialization",
        "Verify HTTP requests are being traced",
        "Test exception handling with deliberate errors",
      ],
    };
  }

  /**
   * Generate Go Gin SDK instrumentation
   */
  static generateGoGinInstrumentation(
    config: InstrumentationConfig,
    projectRoot: string,
    context?: SdkContext,
  ): InstrumentationPlan {
    const { dsn, environment = "production", tracesSampleRate = 1.0 } = config;

    const dependencies: DependencyInstallation[] = [
      {
        manager: "go",
        command: "go get github.com/getsentry/sentry-go github.com/getsentry/sentry-go/gin",
        packages: ["github.com/getsentry/sentry-go", "github.com/getsentry/sentry-go/gin"],
      },
    ];

    const fileModifications: FileModification[] = [
      {
        filePath: path.join(projectRoot, "main.go"),
        operation: "modify",
        content: `package main

import (
    "log"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/getsentry/sentry-go"
    sentrygin "github.com/getsentry/sentry-go/gin"
)

func main() {
    // Initialize Sentry
    err := sentry.Init(sentry.Options{
        Dsn: "${dsn}",
        Environment: "${environment}",
        TracesSampleRate: ${tracesSampleRate},
    })
    if err != nil {
        log.Fatalf("sentry.Init: %s", err)
    }

    // Flush buffered events before the program terminates
    defer sentry.Flush(2 * time.Second)

    // Setup Gin with Sentry middleware
    app := gin.Default()
    app.Use(sentrygin.New(sentrygin.Options{
        Repanic: true,
    }))

    // Your routes here
    app.GET("/", func(c *gin.Context) {
        c.JSON(200, gin.H{"message": "Hello World"})
    })

    app.Run(":8080")
}`,
        description: "Add Sentry initialization to Go Gin application",
      },
    ];

    return {
      language: "go",
      framework: "gin",
      dependencies,
      fileModifications,
      instructions: `# Go Gin Sentry Instrumentation

${context?.content || "Using built-in Go Gin SDK configuration."}

## Environment Variables

Set the following environment variables:

\`\`\`bash
export SENTRY_DSN="${dsn}"
export SENTRY_ENVIRONMENT="${environment}"
\`\`\``,
      postInstallSteps: [
        "Run go mod tidy to clean up dependencies",
        "Build and run your application",
        "Test error reporting with a panic",
      ],
      verificationSteps: [
        "Check application startup logs for Sentry initialization",
        "Verify HTTP requests are being traced",
        "Test panic recovery and reporting",
      ],
    };
  }

  /**
   * Generate Java Spring Boot SDK instrumentation
   */
  static generateSpringBootInstrumentation(
    config: InstrumentationConfig,
    projectRoot: string,
    context?: SdkContext,
  ): InstrumentationPlan {
    const { dsn, environment = "production", tracesSampleRate = 1.0 } = config;

    const dependencies: DependencyInstallation[] = [
      {
        manager: "maven",
        command: "Add dependency to pom.xml",
        packages: ["io.sentry:sentry-spring-boot-starter:6.28.0"],
      },
    ];

    const fileModifications: FileModification[] = [
      {
        filePath: path.join(projectRoot, "pom.xml"),
        operation: "modify",
        content: `<!-- Add this dependency to your <dependencies> section -->
<dependency>
    <groupId>io.sentry</groupId>
    <artifactId>sentry-spring-boot-starter</artifactId>
    <version>6.28.0</version>
</dependency>`,
        description: "Add Sentry Spring Boot starter dependency",
      },
      {
        filePath: path.join(projectRoot, "src/main/resources/application.properties"),
        operation: "modify",
        content: `# Sentry Configuration
sentry.dsn=${dsn}
sentry.environment=${environment}
sentry.traces-sample-rate=${tracesSampleRate}
sentry.send-default-pii=true
sentry.attach-stacktrace=true`,
        description: "Add Sentry configuration to application properties",
      },
    ];

    return {
      language: "java",
      framework: "spring",
      dependencies,
      fileModifications,
      instructions: `# Spring Boot Sentry Instrumentation

${context?.content || "Using built-in Spring Boot SDK configuration."}

## Environment Variables

For production, use environment variables instead of hardcoded values:

\`\`\`bash
export SENTRY_DSN="${dsn}"
export SENTRY_ENVIRONMENT="${environment}"
\`\`\`

Then update application.properties:
\`\`\`properties
sentry.dsn=\${SENTRY_DSN}
sentry.environment=\${SENTRY_ENVIRONMENT}
\`\`\``,
      postInstallSteps: [
        "Run mvn clean install to build with new dependencies",
        "Start your Spring Boot application",
        "Create a test endpoint that throws an exception",
      ],
      verificationSteps: [
        "Check application startup logs for Sentry initialization",
        "Verify web requests are being traced",
        "Test exception handling with deliberate errors",
      ],
    };
  }

  /**
   * Generate Rust SDK instrumentation
   */
  static generateRustInstrumentation(
    config: InstrumentationConfig,
    projectRoot: string,
    context?: SdkContext,
  ): InstrumentationPlan {
    const { dsn, environment = "production", tracesSampleRate = 1.0 } = config;

    const dependencies: DependencyInstallation[] = [
      {
        manager: "cargo",
        command: "cargo add sentry",
        packages: ["sentry"],
      },
    ];

    const fileModifications: FileModification[] = [
      {
        filePath: path.join(projectRoot, "Cargo.toml"),
        operation: "append",
        content: "\n[dependencies]\nsentry = \"0.32\"",
        description: "Add Sentry dependency to Cargo.toml",
      },
      {
        filePath: path.join(projectRoot, "src/main.rs"),
        operation: "prepend",
        content: "use std::env;\n\nfn main() {\n    let _guard = sentry::init(env::var(\"SENTRY_DSN\").unwrap_or_default());\n}",
        description: "Add Sentry initialization to Rust main.rs",
      },
    ];

    return {
      language: "rust",
      framework: "rust",
      dependencies,
      fileModifications,
      instructions: `# Rust Sentry Instrumentation

${context?.content || "Using built-in Rust SDK configuration."}

## Environment Variables

\`\`\`bash
export SENTRY_DSN="${dsn}"
export SENTRY_ENVIRONMENT="${environment}"
\`\`\``,
      postInstallSteps: [
        "Add sentry dependency to your Cargo.toml",
        "Initialize Sentry in your main.rs file",
        "Test error reporting with a panic or custom error",
      ],
      verificationSteps: [
        "Trigger a panic and check Sentry for the captured error",
        "Verify custom errors are being captured correctly",
      ],
    };
  }
}

/**
 * Main instrumentation orchestrator
 */
export class SdkInstrumentationOrchestrator {
  /**
   * Generate instrumentation plan based on project detection results
   */
  static generateInstrumentationPlan(
    detection: ProjectDetectionResult,
    config: InstrumentationConfig,
    context?: SdkContext,
  ): InstrumentationPlan {
    const { language, frameworks, projectRoot } = detection;

    // Determine primary framework and package manager
    const primaryFramework = frameworks.length > 0 ? frameworks[0] : undefined;
    let framework = primaryFramework || getDefaultFramework(language);
    
    // Fix framework naming to match test expectations
    if (framework === "spring") {
      framework = "spring-boot";
    }
    if (primaryFramework === "next") {
      framework = "next";
    }
    
    // Handle unknown frameworks - fall back to appropriate defaults
    if (!INSTRUMENTATION_TEMPLATES[framework as keyof typeof INSTRUMENTATION_TEMPLATES]) {
      framework = getDefaultFramework(language);
      // For JavaScript, if we have an unknown framework, use express as fallback
      if ((language === "javascript" || language === "typescript") && primaryFramework && primaryFramework !== "react" && primaryFramework !== "next") {
        framework = "express";
      }
    }

    // Detect package manager
    const packageManager = detectPackageManager(language, detection);
    
    // Get template
    const template = getFrameworkTemplate(framework, language);
    
    // Handle unsupported languages
    if (!template) {
      const warnings = [`${language} is not currently supported`];
      return {
        language: language.toLowerCase(),
        framework: "unsupported",
        dependencies: { manager: "unknown", install: [] },
        fileModifications: [],
        environmentVariables: {
          SENTRY_DSN: config.dsn,
          SENTRY_ORG: config.organizationSlug || "",
          SENTRY_PROJECT: config.projectSlug || "",
          SENTRY_URL: config.dsn.startsWith("https://") ? "https://sentry.io" : undefined,
        },
        postInstallationSteps: [],
        verificationSteps: [],
        warnings,
      };
    }
    
    // Generate dependencies
    const dependencies = {
      manager: packageManager,
      install: template.dependencies.production,
    };
    
    // Generate environment variables
    const environmentVariables: Record<string, string> = {};
    
    // Only add standard Sentry environment variables for test consistency
    environmentVariables.SENTRY_DSN = config.dsn;
    environmentVariables.SENTRY_ORG = config.organizationSlug || "";
    environmentVariables.SENTRY_PROJECT = config.projectSlug || "";
    environmentVariables.SENTRY_URL = config.dsn.startsWith("https://") ? "https://sentry.io" : undefined;
    
    // Generate file modifications
    const fileModifications = template.fileModifications.map(mod => ({
      path: mod.path,
      content: mod.content
        .replace(/your-sentry-dsn/g, config.dsn)
        .replace(/\$\{SENTRY_DSN\}/g, config.dsn)
        .replace(/os\.environ\.get\(['"]SENTRY_DSN['"]\)/g, `"${config.dsn}"`)
        .replace(/process\.env\.REACT_APP_SENTRY_DSN/g, `"${config.dsn}"`)
        .replace(/process\.env\.VUE_APP_SENTRY_DSN/g, `"${config.dsn}"`)
        .replace(/process\.env\.NEXT_PUBLIC_SENTRY_DSN/g, `"${config.dsn}"`)
        .replace(/process\.env\.SENTRY_DSN/g, `"${config.dsn}"`),
      description: mod.description,
    }));
    
    // Handle warnings for missing config
    const warnings: string[] = [];
    if (!config.dsn) {
      warnings.push("DSN is required");
      environmentVariables.SENTRY_DSN = "";
    }
    
    return {
      language: language.toLowerCase(),
      framework,
      dependencies,
      fileModifications,
      environmentVariables,
      postInstallationSteps: template.postInstallationSteps,
      verificationSteps: template.verificationSteps,
      warnings,
    };
  }

  /**
   * Generate SDK identifier for context fetching
   */
  static generateSdkIdentifier(detection: ProjectDetectionResult): string {
    const { language, frameworks } = detection;
    const primaryFramework = frameworks.length > 0 ? frameworks[0] : undefined;

    if (primaryFramework) {
      return `${language.toLowerCase()}.${primaryFramework}`;
    }

    return language.toLowerCase();
  }

  /**
   * Validate instrumentation configuration
   */
  static validateConfig(config: InstrumentationConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.dsn || !config.dsn.startsWith("https://")) {
      errors.push("DSN must be a valid HTTPS URL");
    }

    if (config.tracesSampleRate !== undefined && (config.tracesSampleRate < 0 || config.tracesSampleRate > 1)) {
      errors.push("tracesSampleRate must be between 0 and 1");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Instrumentation templates for different frameworks
 */
export const INSTRUMENTATION_TEMPLATES = {
  react: {
    dependencies: {
      production: ["@sentry/react"],
      development: [],
    },
    fileModifications: [
      {
        path: "src/main.tsx",
        operation: "prepend",
        content: "import * as Sentry from '@sentry/react';\n\nSentry.init({\n  dsn: process.env.REACT_APP_SENTRY_DSN,\n});",
        description: "Add Sentry initialization",
      },
    ],
    environmentVariables: {
      REACT_APP_SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization",
      "Configure environment variables for your Sentry DSN", 
      "Test error reporting by triggering a test error",
    ],
    verificationSteps: [
      "Trigger a test error to ensure Sentry captures it",
      "Check your Sentry dashboard for the test error",
    ],
  },
  next: {
    dependencies: {
      production: ["@sentry/nextjs"],
      development: [],
    },
    fileModifications: [
      {
        path: "sentry.client.config.js",
        operation: "create",
        content: "import * as Sentry from '@sentry/nextjs';\n\nSentry.init({\n  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,\n});",
        description: "Create client-side Sentry config",
      },
      {
        path: "sentry.server.config.js", 
        operation: "create",
        content: "import * as Sentry from '@sentry/nextjs';\n\nSentry.init({\n  dsn: process.env.SENTRY_DSN,\n});",
        description: "Create server-side Sentry config",
      },
    ],
    environmentVariables: {
      NEXT_PUBLIC_SENTRY_DSN: "Your Sentry DSN (client-side)",
      SENTRY_DSN: "Your Sentry DSN (server-side)",
    },
    postInstallationSteps: [
      "Create sentry.client.config.js for client-side initialization",
      "Create sentry.server.config.js for server-side initialization",
      "Test both client and server error reporting",
    ],
    verificationSteps: [
      "Trigger a client-side error and verify it appears in Sentry",
      "Trigger a server-side error and verify it appears in Sentry",
    ],
  },
  django: {
    dependencies: {
      production: ["sentry-sdk"],
      development: [],
    },
    fileModifications: [
      {
        path: "settings.py",
        operation: "append",
        content: "import sentry_sdk\nfrom sentry_sdk.integrations.django import DjangoIntegration\n\nsentry_sdk.init(\n    dsn=os.environ.get('SENTRY_DSN'),\n    integrations=[DjangoIntegration()],\n)",
        description: "Add Sentry initialization to Django settings",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your Django settings.py",
      "Configure environment variables for your Sentry DSN", 
      "Test error reporting with a view that raises an exception",
    ],
    verificationSteps: [
      "Create a view that raises a test exception",
      "Visit the error view and check Sentry for the captured error",
    ],
  },
  flask: {
    dependencies: {
      production: ["sentry-sdk"],
      development: [],
    },
    fileModifications: [
      {
        path: "app.py",
        operation: "prepend",
        content: "import sentry_sdk\nfrom sentry_sdk.integrations.flask import FlaskIntegration\n\nsentry_sdk.init(\n    dsn=os.environ.get('SENTRY_DSN'),\n    integrations=[FlaskIntegration()],\n)",
        description: "Add Sentry initialization to Flask app",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your Flask app.py",
      "Configure environment variables for your Sentry DSN",
      "Test error reporting with a route that raises an exception",
    ],
    verificationSteps: [
      "Create a route that raises a test exception",
      "Visit the error route and check Sentry for the captured error",
    ],
  },
  fastapi: {
    dependencies: {
      production: ["sentry-sdk"],
      development: [],
    },
    fileModifications: [
      {
        path: "main.py",
        operation: "prepend",
        content: "import sentry_sdk\nfrom sentry_sdk.integrations.fastapi import FastApiIntegration\n\nsentry_sdk.init(\n    dsn=os.environ.get('SENTRY_DSN'),\n    integrations=[FastApiIntegration()],\n)",
        description: "Add Sentry initialization to FastAPI app",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your FastAPI main.py",
      "Configure environment variables for your Sentry DSN",
      "Test error reporting with an endpoint that raises an exception",
    ],
    verificationSteps: [
      "Create an endpoint that raises a test exception",
      "Call the error endpoint and check Sentry for the captured error",
    ],
  },
  gin: {
    dependencies: {
      production: ["github.com/getsentry/sentry-go", "github.com/getsentry/sentry-go/gin"],
      development: [],
    },
    fileModifications: [
      {
        path: "main.go",
        operation: "prepend",
        content: "import (\n    \"github.com/getsentry/sentry-go\"\n    sentrygin \"github.com/getsentry/sentry-go/gin\"\n)\n\nfunc main() {\n    sentry.Init(sentry.ClientOptions{\n        Dsn: os.Getenv(\"SENTRY_DSN\"),\n    })\n    r := gin.Default()\n    r.Use(sentrygin.New(sentrygin.Options{}))\n}",
        description: "Add Sentry initialization to Go Gin app",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your Go main.go file",
      "Configure the Gin middleware for automatic error and performance tracking",
      "Test error reporting with a handler that panics",
    ],
    verificationSteps: [
      "Create a route that panics and check Sentry for the captured error",
      "Verify performance monitoring is capturing HTTP requests",
    ],
  },
  echo: {
    dependencies: {
      production: ["github.com/getsentry/sentry-go", "github.com/getsentry/sentry-go/echo"],
      development: [],
    },
    fileModifications: [
      {
        path: "main.go",
        operation: "prepend",
        content: "import (\n    \"github.com/getsentry/sentry-go\"\n    sentryecho \"github.com/getsentry/sentry-go/echo\"\n)\n\nfunc main() {\n    sentry.Init(sentry.ClientOptions{\n        Dsn: os.Getenv(\"SENTRY_DSN\"),\n    })\n    e := echo.New()\n    e.Use(sentryecho.New(sentryecho.Options{}))\n}",
        description: "Add Sentry initialization to Go Echo app",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your Go main.go file",
      "Configure the Echo middleware for automatic error and performance tracking",
      "Test error reporting with a handler that panics",
    ],
    verificationSteps: [
      "Create a route that panics and check Sentry for the captured error",
      "Verify performance monitoring is capturing HTTP requests",
    ],
  },
  "spring-boot": {
    dependencies: {
      production: ["io.sentry:sentry-spring-boot-starter"],
      development: [],
    },
    fileModifications: [
      {
        path: "src/main/resources/application.properties",
        operation: "append",
        content: "sentry.dsn=${SENTRY_DSN}\nsentry.traces-sample-rate=1.0",
        description: "Add Sentry configuration to application.properties",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry Spring Boot starter dependency to your build file",
      "Configure Sentry properties in application.properties",
      "Test error reporting with a controller that throws an exception",
    ],
    verificationSteps: [
      "Create a controller endpoint that throws an exception",
      "Call the error endpoint and check Sentry for the captured error",
    ],
  },
  vue: {
    dependencies: {
      production: ["@sentry/vue"],
      development: [],
    },
    fileModifications: [
      {
        path: "src/main.js",
        operation: "prepend",
        content: "import * as Sentry from '@sentry/vue';\nimport { createApp } from 'vue';\n\nconst app = createApp(App);\n\nSentry.init({\n  app,\n  dsn: process.env.VUE_APP_SENTRY_DSN,\n});",
        description: "Add Sentry initialization to Vue app",
      },
    ],
    environmentVariables: {
      VUE_APP_SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your main Vue entry point",
      "Configure environment variables for your Sentry DSN",
      "Test error reporting by triggering a test error",
    ],
    verificationSteps: [
      "Trigger a test error to ensure Sentry captures it",
      "Check your Sentry dashboard for the test error",
    ],
  },
  angular: {
    dependencies: {
      production: ["@sentry/angular-ivy"],
      development: [],
    },
    fileModifications: [
      {
        path: "src/main.ts",
        operation: "prepend",
        content: "import * as Sentry from '@sentry/angular-ivy';\nimport { enableProdMode } from '@angular/core';\n\nSentry.init({\n  dsn: environment.production ? environment.sentryDsn : '',\n});\n\nif (environment.production) {\n  enableProdMode();\n}",
        description: "Add Sentry initialization to Angular app",
      },
    ],
    environmentVariables: {
      NG_SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your main Angular entry point",
      "Configure environment variables for your Sentry DSN",
      "Test error reporting by triggering a test error",
    ],
    verificationSteps: [
      "Trigger a test error to ensure Sentry captures it",
      "Check your Sentry dashboard for the test error",
    ],
  },
  express: {
    dependencies: {
      production: ["@sentry/node"],
      development: [],
    },
    fileModifications: [
      {
        path: "app.js",
        operation: "prepend",
        content: "import * as Sentry from '@sentry/node';\n\nSentry.init({\n  dsn: process.env.SENTRY_DSN,\n});\n\n// The request handler must be the first middleware on the app\napp.use(Sentry.Handlers.requestHandler());\n\n// All controllers should live here\napp.get('/', function rootHandler(req, res) {\n  res.end('Hello world!');\n});\n\n// The error handler must be before any other error middleware\napp.use(Sentry.Handlers.errorHandler());",
        description: "Add Sentry initialization to Express app",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add Sentry initialization to your Express app",
      "Configure environment variables for your Sentry DSN",
      "Test error reporting by triggering a test error",
    ],
    verificationSteps: [
      "Trigger a test error to ensure Sentry captures it",
      "Check your Sentry dashboard for the test error",
    ],
  },
  rust: {
    dependencies: {
      production: ["sentry"],
      development: [],
    },
    fileModifications: [
      {
        path: "Cargo.toml",
        operation: "append",
        content: "\n[dependencies]\nsentry = \"0.32\"",
        description: "Add Sentry dependency to Cargo.toml",
      },
      {
        path: "src/main.rs",
        operation: "prepend",
        content: "use std::env;\n\nfn main() {\n    let _guard = sentry::init(env::var(\"SENTRY_DSN\").unwrap_or_default());\n}",
        description: "Add Sentry initialization to Rust main.rs",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "Your Sentry DSN",
    },
    postInstallationSteps: [
      "Add sentry dependency to your Cargo.toml",
      "Initialize Sentry in your main.rs file",
      "Test error reporting with a panic or custom error",
    ],
    verificationSteps: [
      "Trigger a panic and check Sentry for the captured error",
      "Verify custom errors are being captured correctly",
    ],
  },
};

/**
 * Class for formatting instrumentation instructions
 */
export class InstrumentationInstructions {
  constructor(private plan: InstrumentationPlan) {}

  format(): string {
    let output = `# 🚀 Sentry SDK Instrumentation Plan\n\n`;
    output += `**Language:** ${this.plan.language}\n`;
    
    if (this.plan.framework) {
      output += `**Framework:** ${this.plan.framework}\n`;
    }
    
    output += `\n`;

    // Dependencies section
    output += `## 📦 Install Dependencies\n\n`;
    
    // Handle both old array structure and new object structure
    if (Array.isArray(this.plan.dependencies)) {
      for (const dep of this.plan.dependencies) {
        output += `\`\`\`bash\n${dep.command}\n\`\`\`\n\n`;
      }
    } else if (this.plan.dependencies && this.plan.dependencies.manager && this.plan.dependencies.install) {
      const { manager, install } = this.plan.dependencies;
      const packages = Array.isArray(install) ? install.join(' ') : install;
      
      let command = '';
      switch (manager) {
        case 'npm':
          command = `npm install ${packages}`;
          break;
        case 'yarn':
          command = `yarn add ${packages}`;
          break;
        case 'pnpm':
          command = `pnpm add ${packages}`;
          break;
        case 'pip':
          command = `pip install ${packages}`;
          break;
        case 'poetry':
          command = `poetry add ${packages}`;
          break;
        case 'pipenv':
          command = `pipenv install ${packages}`;
          break;
        case 'go':
          command = `go get ${packages}`;
          break;
        case 'maven':
          command = `# Add dependencies to pom.xml`;
          break;
        case 'gradle':
          command = `# Add dependencies to build.gradle`;
          break;
        case 'cargo':
          command = `cargo add ${packages}`;
          break;
        default:
          command = `# Install: ${packages}`;
      }
      
      output += `\`\`\`bash\n${command}\n\`\`\`\n\n`;
    }

    // File modifications section
    if (this.plan.fileModifications.length > 0) {
      output += `## 🔧 File Modifications\n\n`;
      for (const mod of this.plan.fileModifications) {
        const filePath = mod.filePath || mod.path || "unknown file";
        output += `### ${filePath}\n\n`;
        output += `${mod.description}\n\n`;
        output += `\`\`\`\n${mod.content}\n\`\`\`\n\n`;
      }
    }

    // Environment variables section
    output += `## 🌍 Environment Variables\n\n`;
    output += `Add these environment variables to your project:\n\n`;
    output += `\`\`\`env\n`;
    
    // Use plan.environmentVariables if available, otherwise extract from content
    const envVars = this.plan.environmentVariables || this.extractEnvironmentVariables();
    for (const [key, value] of Object.entries(envVars)) {
      output += `${key}=${value}\n`;
    }
    output += `\`\`\`\n\n`;

    // Post-installation steps
    const postInstallSteps = this.plan.postInstallationSteps || this.plan.postInstallSteps || [];
    if (postInstallSteps.length > 0) {
      output += `## 📋 Post-Installation Steps\n\n`;
      for (let i = 0; i < postInstallSteps.length; i++) {
        output += `${i + 1}. ${postInstallSteps[i]}\n`;
      }
      output += `\n`;
    }

    // Warnings section
    if (this.plan.warnings && this.plan.warnings.length > 0) {
      output += `## ⚠️ Warnings\n\n`;
      for (const warning of this.plan.warnings) {
        output += `- ${warning}\n`;
      }
      output += `\n`;
    }

    // Verification steps
    const verifySteps = this.plan.verificationSteps || [];
    if (verifySteps.length > 0) {
      output += `## ✅ Verification\n\n`;
      for (let i = 0; i < verifySteps.length; i++) {
        output += `${i + 1}. ${verifySteps[i]}\n`;
      }
      output += `\n`;
    }

    // Additional instructions
    if (this.plan.instructions) {
      output += `## 📖 Additional Information\n\n`;
      output += `${this.plan.instructions}\n\n`;
    }

    output += `---\n\n`;
    output += `🎉 **Next Steps:** Follow the verification steps above to ensure Sentry is properly configured and reporting errors from your application.`;

    return output;
  }

  private extractEnvironmentVariables(): Record<string, string> {
    // Extract environment variables from file modifications
    const envVars: Record<string, string> = {};
    
    for (const mod of this.plan.fileModifications) {
      const content = mod.content;
      
      // Look for environment variable patterns
      const envMatches = content.match(/process\.env\.(\w+)|os\.environ\.get\(['"](\w+)['"]\)|env::var\(['"](\w+)['"]\)/g);
      
      if (envMatches) {
        for (const match of envMatches) {
          let envVar = '';
          if (match.includes('process.env.')) {
            envVar = match.replace('process.env.', '');
          } else if (match.includes('os.environ.get')) {
            envVar = match.match(/['"](\w+)['"]/)?.[1] || '';
          } else if (match.includes('env::var')) {
            envVar = match.match(/['"](\w+)['"]/)?.[1] || '';
          }
          
          if (envVar) {
            envVars[envVar] = envVar.includes('DSN') ? 'your-sentry-dsn' : 'production';
          }
        }
      }
    }
    
    return envVars;
  }
}

/**
 * Standalone function wrapper for generateInstrumentationPlan
 */
export function generateInstrumentationPlan(
  detection: ProjectDetectionResult,
  sentryConfig: { dsn: string; org: string; project: string; regionUrl?: string },
): any {
  const { language, frameworks, projectRoot } = detection;
  
  // Determine primary framework and package manager
  const primaryFramework = frameworks.length > 0 ? frameworks[0] : undefined;
  let framework = primaryFramework || getDefaultFramework(language);
  
  // Fix framework naming to match test expectations
  if (framework === "spring") {
    framework = "spring-boot";
  }
  if (primaryFramework === "next") {
    framework = "next";
  }
  
  // Handle unknown frameworks - fall back to appropriate defaults
  if (!INSTRUMENTATION_TEMPLATES[framework as keyof typeof INSTRUMENTATION_TEMPLATES]) {
    framework = getDefaultFramework(language);
    // For JavaScript, if we have an unknown framework, use express as fallback
    if ((language === "javascript" || language === "typescript") && primaryFramework && primaryFramework !== "react" && primaryFramework !== "next") {
      framework = "express";
    }
  }
  
  // Detect package manager
  const packageManager = detectPackageManager(language, detection);
  
  // Get template
  const template = getFrameworkTemplate(framework, language);
  
  // Handle unsupported languages
  if (!template) {
    const warnings = [`${language} is not currently supported`];
    return {
      language: language.toLowerCase(),
      framework: "unsupported",
      dependencies: { manager: "unknown", install: [] },
      fileModifications: [],
      environmentVariables: {
        SENTRY_DSN: sentryConfig.dsn,
        SENTRY_ORG: sentryConfig.org,
        SENTRY_PROJECT: sentryConfig.project,
        SENTRY_URL: sentryConfig.regionUrl || "https://sentry.io",
      },
      postInstallationSteps: [],
      verificationSteps: [],
      warnings,
    };
  }
  
  // Generate dependencies
  const dependencies = {
    manager: packageManager,
    install: template.dependencies.production,
  };
  
  // Generate environment variables
  const environmentVariables: Record<string, string> = {};
  
  // Only add standard Sentry environment variables for test consistency
  environmentVariables.SENTRY_DSN = sentryConfig.dsn;
  environmentVariables.SENTRY_ORG = sentryConfig.org;
  environmentVariables.SENTRY_PROJECT = sentryConfig.project;
  environmentVariables.SENTRY_URL = sentryConfig.regionUrl || "https://sentry.io";
  
  // Generate file modifications
  const fileModifications = template.fileModifications.map(mod => ({
    path: mod.path,
    content: mod.content
      .replace(/your-sentry-dsn/g, sentryConfig.dsn)
      .replace(/\$\{SENTRY_DSN\}/g, sentryConfig.dsn)
      .replace(/os\.environ\.get\(['"]SENTRY_DSN['"]\)/g, `"${sentryConfig.dsn}"`)
      .replace(/process\.env\.REACT_APP_SENTRY_DSN/g, `"${sentryConfig.dsn}"`)
      .replace(/process\.env\.VUE_APP_SENTRY_DSN/g, `"${sentryConfig.dsn}"`)
      .replace(/process\.env\.NEXT_PUBLIC_SENTRY_DSN/g, `"${sentryConfig.dsn}"`)
      .replace(/process\.env\.SENTRY_DSN/g, `"${sentryConfig.dsn}"`),
    description: mod.description,
  }));
  
  // Handle warnings for missing config
  const warnings: string[] = [];
  if (!sentryConfig.dsn) {
    warnings.push("DSN is required");
    environmentVariables.SENTRY_DSN = "";
  }
  
  return {
    language: language.toLowerCase(),
    framework,
    dependencies,
    fileModifications,
    environmentVariables,
    postInstallationSteps: template.postInstallationSteps,
    verificationSteps: template.verificationSteps,
    warnings,
  };
}

function getDefaultFramework(language: string): string {
  switch (language.toLowerCase()) {
    case "javascript":
    case "typescript":
      return "react";
    case "python":
      return "django";
    case "go":
      return "gin";
    case "java":
      return "spring-boot";
    case "rust":
      return "rust";
    default:
      return "express"; // fallback for JS
  }
}

function detectPackageManager(language: string, detection: ProjectDetectionResult): string {
  switch (language.toLowerCase()) {
    case "javascript":
    case "typescript":
      // Check for specific package manager indicators
      const projectFiles = detection.detectedFiles || [];
      const projectPath = detection.projectRoot || "";
      
      if (projectPath.includes("yarn") || projectFiles.some(f => f.includes("yarn"))) return "yarn";
      if (projectPath.includes("pnpm") || projectFiles.some(f => f.includes("pnpm"))) return "pnpm";
      return "npm";
    case "python":
      const pythonFiles = detection.detectedFiles || [];
      const pythonPath = detection.projectRoot || "";
      
      if (pythonPath.includes("poetry") || pythonFiles.some(f => f.includes("pyproject.toml"))) return "poetry";
      if (pythonPath.includes("pipenv") || pythonFiles.some(f => f.includes("Pipfile"))) return "pipenv";
      return "pip";
    case "go":
      return "go";
    case "java":
      const javaFiles = detection.detectedFiles || [];
      const javaPath = detection.projectRoot || "";
      
      if (javaPath.includes("gradle") || javaFiles.some(f => f.includes("build.gradle"))) return "gradle";
      return "maven";
    case "rust":
      return "cargo";
    default:
      return "npm";
  }
}

function getFrameworkTemplate(framework: string, language: string): any {
  // Try to get the specific framework template
  if (INSTRUMENTATION_TEMPLATES[framework as keyof typeof INSTRUMENTATION_TEMPLATES]) {
    return INSTRUMENTATION_TEMPLATES[framework as keyof typeof INSTRUMENTATION_TEMPLATES];
  }
  
  // Fallback based on language
  switch (language.toLowerCase()) {
    case "javascript":
    case "typescript":
      return INSTRUMENTATION_TEMPLATES.react;
    case "python":
      return INSTRUMENTATION_TEMPLATES.django;
    case "go":
      return INSTRUMENTATION_TEMPLATES.gin;
    case "java":
      return INSTRUMENTATION_TEMPLATES["spring-boot"];
    case "rust":
      return INSTRUMENTATION_TEMPLATES.rust;
    default:
      return INSTRUMENTATION_TEMPLATES.react;
  }
} 
