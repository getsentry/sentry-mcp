import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateInstrumentationPlan,
  InstrumentationInstructions,
  INSTRUMENTATION_TEMPLATES,
  type ProjectDetectionResult,
} from "./sdkInstrumentation";
import { DependencyManagerType } from "./dependencyManager";

describe("INSTRUMENTATION_TEMPLATES", () => {
  it("should have templates for all supported frameworks", () => {
    const expectedFrameworks = [
      "react",
      "next",
      "vue", 
      "angular",
      "express",
      "django",
      "flask",
      "fastapi",
      "gin",
      "echo",
      "spring-boot",
      "rust",
    ];

    expectedFrameworks.forEach(framework => {
      expect(INSTRUMENTATION_TEMPLATES).toHaveProperty(framework);
    });
  });

  describe("React template", () => {
    const template = INSTRUMENTATION_TEMPLATES.react;

    it("should include Sentry React SDK", () => {
      expect(template.dependencies.production).toContain("@sentry/react");
    });

    it("should have initialization file modifications", () => {
      expect(template.fileModifications).toHaveLength(1);
      expect(template.fileModifications[0].path).toBe("src/main.tsx");
      expect(template.fileModifications[0].operation).toBe("prepend");
    });

    it("should have post-installation steps", () => {
      expect(template.postInstallationSteps).toContain(
        expect.stringContaining("Add Sentry initialization")
      );
    });
  });

  describe("Django template", () => {
    const template = INSTRUMENTATION_TEMPLATES.django;

    it("should include Sentry Django SDK", () => {
      expect(template.dependencies.production).toContain("sentry-sdk");
    });

    it("should modify settings.py", () => {
      const settingsModification = template.fileModifications.find(
        mod => mod.path === "settings.py"
      );
      expect(settingsModification).toBeDefined();
      expect(settingsModification!.operation).toBe("append");
    });

    it("should have environment variable setup", () => {
      expect(template.environmentVariables).toHaveProperty("SENTRY_DSN");
    });
  });

  describe("Go Gin template", () => {
    const template = INSTRUMENTATION_TEMPLATES.gin;

    it("should include Sentry Go SDK", () => {
      expect(template.dependencies.production).toContain("github.com/getsentry/sentry-go");
      expect(template.dependencies.production).toContain("github.com/getsentry/sentry-go/gin");
    });

    it("should modify main.go", () => {
      const mainModification = template.fileModifications.find(
        mod => mod.path === "main.go"
      );
      expect(mainModification).toBeDefined();
      expect(mainModification!.content).toContain("sentry.Init");
    });
  });

  describe("Spring Boot template", () => {
    const template = INSTRUMENTATION_TEMPLATES["spring-boot"];

    it("should include Sentry Spring Boot SDK", () => {
      expect(template.dependencies.production).toContain("io.sentry:sentry-spring-boot-starter");
    });

    it("should have application.properties setup", () => {
      const propsModification = template.fileModifications.find(
        mod => mod.path === "src/main/resources/application.properties"
      );
      expect(propsModification).toBeDefined();
    });
  });
});

describe("generateInstrumentationPlan", () => {
  const mockSentryConfig = {
    dsn: "https://abc123@o123456.ingest.sentry.io/4567890",
    org: "test-org",
    project: "test-project",
    regionUrl: "https://sentry.io",
  };

  describe("React project", () => {
    const mockProject: ProjectDetectionResult = {
      language: "javascript",
      frameworks: ["react"],
      confidence: 0.95,
      detectedFiles: ["package.json"],
      projectRoot: "/test/react-app",
    };

    it("should generate plan for React project", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.language).toBe("javascript");
      expect(plan.framework).toBe("react");
      expect(plan.dependencies.manager).toBe("npm");
      expect(plan.dependencies.install).toContain("@sentry/react");
      expect(plan.fileModifications).toHaveLength(1);
      expect(plan.environmentVariables.SENTRY_DSN).toBe(mockSentryConfig.dsn);
    });

    it("should detect yarn if package.json has yarn", async () => {
      const projectWithYarn = {
        ...mockProject,
        detectedFiles: ["package.json", "yarn.lock"],
      };

      const plan = await generateInstrumentationPlan(projectWithYarn, mockSentryConfig);

      expect(plan.dependencies.manager).toBe("yarn");
    });

    it("should detect pnpm if package.json has pnpm", async () => {
      const projectWithPnpm = {
        ...mockProject,
        detectedFiles: ["package.json", "pnpm-lock.yaml"],
      };

      const plan = await generateInstrumentationPlan(projectWithPnpm, mockSentryConfig);

      expect(plan.dependencies.manager).toBe("pnpm");
    });
  });

  describe("Next.js project", () => {
    const mockProject: ProjectDetectionResult = {
      language: "javascript",
      frameworks: ["next"],
      confidence: 0.95,
      detectedFiles: ["package.json", "next.config.js"],
      projectRoot: "/test/nextjs-app",
    };

    it("should generate plan for Next.js project", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.framework).toBe("next");
      expect(plan.dependencies.install).toContain("@sentry/nextjs");
      
      // Should have multiple file modifications for Next.js
      expect(plan.fileModifications.length).toBeGreaterThan(1);
      
      const sentryConfigJs = plan.fileModifications.find(
        mod => mod.path === "sentry.client.config.js"
      );
      expect(sentryConfigJs).toBeDefined();
    });

    it("should include Next.js specific post-installation steps", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.postInstallationSteps).toContain(
        expect.stringContaining("sentry.client.config.js")
      );
      expect(plan.postInstallationSteps).toContain(
        expect.stringContaining("sentry.server.config.js")
      );
    });
  });

  describe("Django project", () => {
    const mockProject: ProjectDetectionResult = {
      language: "python",
      frameworks: ["django"],
      confidence: 0.95,
      detectedFiles: ["requirements.txt", "manage.py"],
      projectRoot: "/test/django-app",
    };

    it("should generate plan for Django project", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.language).toBe("python");
      expect(plan.framework).toBe("django");
      expect(plan.dependencies.manager).toBe("pip");
      expect(plan.dependencies.install).toContain("sentry-sdk");
    });

    it("should detect poetry if pyproject.toml exists", async () => {
      const projectWithPoetry = {
        ...mockProject,
        detectedFiles: ["pyproject.toml", "poetry.lock"],
      };

      const plan = await generateInstrumentationPlan(projectWithPoetry, mockSentryConfig);

      expect(plan.dependencies.manager).toBe("poetry");
    });

    it("should modify settings.py", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      const settingsModification = plan.fileModifications.find(
        mod => mod.path === "settings.py"
      );
      expect(settingsModification).toBeDefined();
      expect(settingsModification!.content).toContain("sentry_sdk.init");
      expect(settingsModification!.content).toContain(mockSentryConfig.dsn);
    });
  });

  describe("Flask project", () => {
    const mockProject: ProjectDetectionResult = {
      language: "python",
      frameworks: ["flask"],
      confidence: 0.95,
      detectedFiles: ["requirements.txt", "app.py"],
      projectRoot: "/test/flask-app",
    };

    it("should generate plan for Flask project", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.framework).toBe("flask");
      expect(plan.dependencies.install).toContain("sentry-sdk");
      
      const appModification = plan.fileModifications.find(
        mod => mod.path === "app.py"
      );
      expect(appModification).toBeDefined();
      expect(appModification!.content).toContain("FlaskIntegration");
    });
  });

  describe("Go Gin project", () => {
    const mockProject: ProjectDetectionResult = {
      language: "go",
      frameworks: ["gin"],
      confidence: 0.95,
      detectedFiles: ["go.mod", "main.go"],
      projectRoot: "/test/gin-app",
    };

    it("should generate plan for Gin project", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.language).toBe("go");
      expect(plan.framework).toBe("gin");
      expect(plan.dependencies.manager).toBe("go");
      expect(plan.dependencies.install).toContain("github.com/getsentry/sentry-go");
      expect(plan.dependencies.install).toContain("github.com/getsentry/sentry-go/gin");
    });

    it("should modify main.go with Gin middleware", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      const mainModification = plan.fileModifications.find(
        mod => mod.path === "main.go"
      );
      expect(mainModification).toBeDefined();
      expect(mainModification!.content).toContain("sentry.Init");
      expect(mainModification!.content).toContain("sentrygin.New");
    });
  });

  describe("Spring Boot project", () => {
    const mockProject: ProjectDetectionResult = {
      language: "java",
      frameworks: ["spring-boot"],
      confidence: 0.95,
      detectedFiles: ["pom.xml"],
      projectRoot: "/test/spring-app",
    };

    it("should generate plan for Spring Boot project", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.language).toBe("java");
      expect(plan.framework).toBe("spring-boot");  
      expect(plan.dependencies.manager).toBe("maven");
      expect(plan.dependencies.install).toContain("io.sentry:sentry-spring-boot-starter");
    });

    it("should detect gradle if build.gradle exists", async () => {
      const projectWithGradle = {
        ...mockProject,
        detectedFiles: ["build.gradle"],
      };

      const plan = await generateInstrumentationPlan(projectWithGradle, mockSentryConfig);

      expect(plan.dependencies.manager).toBe("gradle");
    });

    it("should modify application.properties", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      const propsModification = plan.fileModifications.find(
        mod => mod.path === "src/main/resources/application.properties"
      );
      expect(propsModification).toBeDefined();
      expect(propsModification!.content).toContain(`sentry.dsn=${mockSentryConfig.dsn}`);
    });
  });

  describe("Rust project", () => {
    const mockProject: ProjectDetectionResult = {
      language: "rust",
      frameworks: ["rust"],
      confidence: 0.9,
      detectedFiles: ["Cargo.toml"],
      projectRoot: "/test/rust-app",
    };

    it("should generate plan for Rust project", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.language).toBe("rust");
      expect(plan.framework).toBe("rust");
      expect(plan.dependencies.manager).toBe("cargo");
      expect(plan.dependencies.install).toContain("sentry");
    });

    it("should modify Cargo.toml and main.rs", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      const cargoModification = plan.fileModifications.find(
        mod => mod.path === "Cargo.toml"
      );
      expect(cargoModification).toBeDefined();

      const mainModification = plan.fileModifications.find(
        mod => mod.path === "src/main.rs"
      );
      expect(mainModification).toBeDefined();
      expect(mainModification!.content).toContain("sentry::init");
    });
  });

  describe("Multiple frameworks", () => {
    const mockProject: ProjectDetectionResult = {
      language: "javascript",
      frameworks: ["react", "express"],
      confidence: 0.9,
      detectedFiles: ["package.json"],
      projectRoot: "/test/fullstack-app",
    };

    it("should prioritize primary framework", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      // Should pick React as primary framework
      expect(plan.framework).toBe("react");
      expect(plan.dependencies.install).toContain("@sentry/react");
    });
  });

  describe("Unknown framework fallback", () => {
    const mockProject: ProjectDetectionResult = {
      language: "javascript",
      frameworks: ["unknown-framework"],
      confidence: 0.5,
      detectedFiles: ["package.json"],
      projectRoot: "/test/unknown-app",
    };

    it("should fall back to generic Node.js instrumentation", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.framework).toBe("express"); // Express as fallback for JS
      expect(plan.dependencies.install).toContain("@sentry/node");
    });
  });

  describe("Environment variables", () => {
    const mockProject: ProjectDetectionResult = {
      language: "javascript",
      frameworks: ["react"],
      confidence: 0.95,
      detectedFiles: ["package.json"],
      projectRoot: "/test/react-app",
    };

    it("should include all required environment variables", async () => {
      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.environmentVariables).toEqual({
        SENTRY_DSN: mockSentryConfig.dsn,
        SENTRY_ORG: mockSentryConfig.org,
        SENTRY_PROJECT: mockSentryConfig.project,
        SENTRY_URL: mockSentryConfig.regionUrl,
      });
    });

    it("should handle custom region URLs", async () => {
      const customRegionConfig = {
        ...mockSentryConfig,
        regionUrl: "https://custom.sentry.io",
      };

      const plan = await generateInstrumentationPlan(mockProject, customRegionConfig);

      expect(plan.environmentVariables.SENTRY_URL).toBe("https://custom.sentry.io");
    });
  });

  describe("Error handling", () => {
    it("should handle missing DSN gracefully", async () => {
      const mockProject: ProjectDetectionResult = {
        language: "javascript",
        frameworks: ["react"],
        confidence: 0.95,
        detectedFiles: ["package.json"],
        projectRoot: "/test/react-app",
      };

      const configWithoutDsn = {
        ...mockSentryConfig,
        dsn: "",
      };

      const plan = await generateInstrumentationPlan(mockProject, configWithoutDsn);

      expect(plan.environmentVariables.SENTRY_DSN).toBe("");
      expect(plan.warnings).toContain(
        expect.stringContaining("DSN is required")
      );
    });

    it("should handle unsupported language", async () => {
      const mockProject: ProjectDetectionResult = {
        language: "cobol",
        frameworks: [],
        confidence: 0.5,
        detectedFiles: [],
        projectRoot: "/test/cobol-app",
      };

      const plan = await generateInstrumentationPlan(mockProject, mockSentryConfig);

      expect(plan.warnings).toContain(
        expect.stringContaining("cobol is not currently supported")
      );
    });
  });
});

describe("InstrumentationInstructions", () => {
  const mockPlan = {
    language: "javascript",
    framework: "react",
    dependencies: {
      manager: "npm" as DependencyManagerType,
      install: ["@sentry/react"],
      installCommand: "npm install @sentry/react",
    },
    fileModifications: [
      {
        path: "src/main.tsx",
        operation: "prepend" as const,
        content: "import * as Sentry from '@sentry/react';",
        description: "Add Sentry import",
      },
    ],
    environmentVariables: {
      SENTRY_DSN: "https://abc123@o123456.ingest.sentry.io/4567890",
      SENTRY_ORG: "test-org",
      SENTRY_PROJECT: "test-project",
      SENTRY_URL: "https://sentry.io",
    },
    postInstallationSteps: ["Configure Sentry in your app"],
    verificationSteps: ["Check that errors are reported"],
    warnings: [],
  };

  it("should format installation instructions", () => {
    const instructions = new InstrumentationInstructions(mockPlan);
    const formatted = instructions.format();

    expect(formatted).toContain("# 🚀 Sentry SDK Instrumentation Plan");
    expect(formatted).toContain("## 📦 Install Dependencies");
    expect(formatted).toContain("npm install @sentry/react");
    expect(formatted).toContain("## 🔧 File Modifications");
    expect(formatted).toContain("src/main.tsx");
    expect(formatted).toContain("## 🌍 Environment Variables");
    expect(formatted).toContain("SENTRY_DSN=");
  });

  it("should include warnings section when warnings exist", () => {
    const planWithWarnings = {
      ...mockPlan,
      warnings: ["DSN is required for error reporting"],
    };

    const instructions = new InstrumentationInstructions(planWithWarnings);
    const formatted = instructions.format();

    expect(formatted).toContain("## ⚠️ Warnings");
    expect(formatted).toContain("DSN is required for error reporting");
  });

  it("should include post-installation steps", () => {
    const instructions = new InstrumentationInstructions(mockPlan);
    const formatted = instructions.format();

    expect(formatted).toContain("## 📋 Post-Installation Steps");
    expect(formatted).toContain("Configure Sentry in your app");
  });

  it("should include verification steps", () => {
    const instructions = new InstrumentationInstructions(mockPlan);
    const formatted = instructions.format();

    expect(formatted).toContain("## ✅ Verification");
    expect(formatted).toContain("Check that errors are reported");
  });
}); 
