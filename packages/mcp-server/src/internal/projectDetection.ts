/**
 * Project detection utilities for Sentry SDK instrumentation.
 *
 * Scans common dependency files to detect project language, framework, and
 * technology stack. Provides confidence-scored results to guide appropriate
 * Sentry SDK selection and configuration.
 */
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Supported project languages and their associated frameworks
 */
export const PROJECT_LANGUAGES = {
  javascript: ["react", "vue", "angular", "next", "express", "node"],
  typescript: ["react", "vue", "angular", "next", "express", "node"],
  python: ["django", "flask", "fastapi", "tornado"],
  go: ["gin", "echo", "fiber", "gorilla"],
  java: ["spring", "spring-boot", "maven", "gradle"],
  csharp: ["aspnet", "aspnet-core", "dotnet"],
  php: ["laravel", "symfony", "codeigniter"],
  ruby: ["rails", "sinatra", "hanami"],
} as const;

/**
 * Dependency file patterns for different languages
 */
export const DEPENDENCY_FILES = {
  javascript: ["package.json", "yarn.lock", "package-lock.json"],
  typescript: ["package.json", "tsconfig.json", "yarn.lock", "package-lock.json"],
  python: ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile", "poetry.lock"],
  go: ["go.mod", "go.sum", "Gopkg.toml", "Gopkg.lock"],
  java: ["pom.xml", "build.gradle", "gradle.properties", "build.gradle.kts"],
  csharp: ["*.csproj", "*.sln", "packages.config", "project.json"],
  php: ["composer.json", "composer.lock"],
  ruby: ["Gemfile", "Gemfile.lock", "*.gemspec"],
} as const;

/**
 * Framework detection patterns within dependency files
 */
export const FRAMEWORK_PATTERNS = {
  react: ["react", "@types/react", "react-dom"],
  vue: ["vue", "@vue/cli", "nuxt"],
  angular: ["@angular/core", "@angular/cli"],
  next: ["next", "next.js"],
  express: ["express", "@types/express"],
  django: ["Django", "django"],
  flask: ["Flask", "flask"],
  fastapi: ["fastapi", "FastAPI"],
  gin: ["github.com/gin-gonic/gin"],
  echo: ["github.com/labstack/echo"],
  spring: ["org.springframework", "spring-boot-starter"],
  laravel: ["laravel/framework", "laravel/laravel"],
  symfony: ["symfony/symfony", "symfony/framework"],
  rails: ["rails", "railties"],
} as const;

/**
 * Schema for project detection results
 */
export const ProjectDetectionResultSchema = z.object({
  language: z.string(),
  frameworks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  detectedFiles: z.array(z.string()),
  projectRoot: z.string(),
});

export type ProjectDetectionResult = z.infer<typeof ProjectDetectionResultSchema>;

/**
 * Schema for framework detection with confidence scoring
 */
export const FrameworkDetectionSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
});

export type FrameworkDetection = z.infer<typeof FrameworkDetectionSchema>;

/**
 * Schema for ambiguity resolution when multiple options are detected
 */
export const AmbiguityResolutionSchema = z.object({
  hasAmbiguity: z.boolean(),
  type: z.enum(["multiple_languages", "multiple_frameworks", "low_confidence"]),
  message: z.string(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    confidence: z.number(),
    recommended: z.boolean().optional(),
  })),
  recommendation: z.string().optional(),
});

export type AmbiguityResolution = z.infer<typeof AmbiguityResolutionSchema>;

/**
 * Utility functions for file system operations
 */
export class FileSystemUtils {
  /**
   * Check if a file exists at the given path
   */
  static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read and parse JSON file safely
   */
  static async readJsonFile(filePath: string): Promise<Record<string, any> | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Read text file content safely
   */
  static async readTextFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Find project root by looking for common root indicators
   */
  static async findProjectRoot(startPath: string = process.cwd()): Promise<string> {
    const rootIndicators = [
      ".git",
      "package.json",
      "requirements.txt",
      "go.mod",
      "pom.xml",
      "Cargo.toml",
      "composer.json",
      "Gemfile",
    ];

    let currentPath = path.resolve(startPath);
    const rootPath = path.parse(currentPath).root;

    while (currentPath !== rootPath) {
      for (const indicator of rootIndicators) {
        const indicatorPath = path.join(currentPath, indicator);
        if (await FileSystemUtils.fileExists(indicatorPath)) {
          return currentPath;
        }
      }
      currentPath = path.dirname(currentPath);
    }

    return startPath; // Fallback to provided path
  }
}

/**
 * Scan package.json for JavaScript/TypeScript projects
 */
export async function scanPackageJson(projectRoot: string): Promise<FrameworkDetection[]> {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = await FileSystemUtils.readJsonFile(packageJsonPath);
  
  if (!packageJson) {
    return [];
  }

  const frameworks: FrameworkDetection[] = [];
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
  };

  // Check for React
  if (allDependencies.react || allDependencies["@types/react"]) {
    const evidence = [];
    if (allDependencies.react) evidence.push("react dependency");
    if (allDependencies["@types/react"]) evidence.push("@types/react dependency");
    
    frameworks.push({
      name: "react",
      confidence: 0.95,
      evidence,
    });
  }

  // Check for Next.js
  if (allDependencies.next) {
    frameworks.push({
      name: "next",
      confidence: 0.95,
      evidence: ["next dependency"],
    });
  }

  // Check for Vue
  if (allDependencies.vue || allDependencies["@vue/cli"]) {
    const evidence = [];
    if (allDependencies.vue) evidence.push("vue dependency");
    if (allDependencies["@vue/cli"]) evidence.push("@vue/cli dependency");
    
    frameworks.push({
      name: "vue",
      confidence: 0.95,
      evidence,
    });
  }

  // Check for Angular
  if (allDependencies["@angular/core"]) {
    frameworks.push({
      name: "angular",
      confidence: 0.95,
      evidence: ["@angular/core dependency"],
    });
  }

  // Check for Express
  if (allDependencies.express) {
    frameworks.push({
      name: "express",
      confidence: 0.9,
      evidence: ["express dependency"],
    });
  }

  return frameworks;
}

/**
 * Scan requirements.txt for Python projects
 */
export async function scanRequirementsTxt(projectRoot: string): Promise<FrameworkDetection[]> {
  const requirementsPath = path.join(projectRoot, "requirements.txt");
  const content = await FileSystemUtils.readTextFile(requirementsPath);
  
  if (!content) {
    return [];
  }

  const frameworks: FrameworkDetection[] = [];
  const lines = content.toLowerCase().split("\n");

  // Check for Django
  if (lines.some(line => line.includes("django"))) {
    frameworks.push({
      name: "django",
      confidence: 0.95,
      evidence: ["django in requirements.txt"],
    });
  }

  // Check for Flask
  if (lines.some(line => line.includes("flask"))) {
    frameworks.push({
      name: "flask",
      confidence: 0.95,
      evidence: ["flask in requirements.txt"],
    });
  }

  // Check for FastAPI
  if (lines.some(line => line.includes("fastapi"))) {
    frameworks.push({
      name: "fastapi",
      confidence: 0.95,
      evidence: ["fastapi in requirements.txt"],
    });
  }

  return frameworks;
}

/**
 * Scan go.mod for Go projects
 */
export async function scanGoMod(projectRoot: string): Promise<FrameworkDetection[]> {
  const goModPath = path.join(projectRoot, "go.mod");
  const content = await FileSystemUtils.readTextFile(goModPath);
  
  if (!content) {
    return [];
  }

  const frameworks: FrameworkDetection[] = [];

  // Check for Gin
  if (content.includes("github.com/gin-gonic/gin")) {
    frameworks.push({
      name: "gin",
      confidence: 0.95,
      evidence: ["gin framework in go.mod"],
    });
  }

  // Check for Echo
  if (content.includes("github.com/labstack/echo")) {
    frameworks.push({
      name: "echo",
      confidence: 0.95,
      evidence: ["echo framework in go.mod"],
    });
  }

  return frameworks;
}

/**
 * Scan pom.xml for Java projects
 */
export async function scanPomXml(projectRoot: string): Promise<FrameworkDetection[]> {
  const pomPath = path.join(projectRoot, "pom.xml");
  const content = await FileSystemUtils.readTextFile(pomPath);
  
  if (!content) {
    return [];
  }

  const frameworks: FrameworkDetection[] = [];

  // Check for Spring Boot
  if (content.includes("spring-boot-starter") || content.includes("org.springframework")) {
    frameworks.push({
      name: "spring",
      confidence: 0.95,
      evidence: ["spring framework in pom.xml"],
    });
  }

  return frameworks;
}

/**
 * Scan Cargo.toml for Rust projects
 */
export async function scanCargoToml(projectRoot: string): Promise<FrameworkDetection[]> {
  const cargoPath = path.join(projectRoot, "Cargo.toml");
  const content = await FileSystemUtils.readTextFile(cargoPath);
  
  if (!content) {
    return [];
  }

  const frameworks: FrameworkDetection[] = [];

  // For now, just detect Rust projects - specific framework detection can be added later
  if (content.includes("[package]")) {
    frameworks.push({
      name: "rust",
      confidence: 0.9,
      evidence: ["Cargo.toml detected"],
    });
  }

  return frameworks;
}

/**
 * Analyze detection results for ambiguity and provide resolution options
 */
export function analyzeDetectionAmbiguity(results: ProjectDetectionResult[]): AmbiguityResolution {
  // No results - this is an ambiguity case
  if (results.length === 0) {
    return {
      hasAmbiguity: true,
      type: "low_confidence",
      message: "No supported project files detected. Please specify your project type manually.",
      options: [
        {
          id: "javascript",
          label: "JavaScript/Node.js",
          description: "JavaScript project with Node.js runtime",
          confidence: 0,
        },
        {
          id: "typescript",
          label: "TypeScript",
          description: "TypeScript project with type safety",
          confidence: 0,
        },
        {
          id: "python",
          label: "Python",
          description: "Python project with Django, Flask, or FastAPI",
          confidence: 0,
        },
        {
          id: "go",
          label: "Go",
          description: "Go project with Gin, Echo, or standard library",
          confidence: 0,
        },
        {
          id: "java",
          label: "Java",
          description: "Java project with Spring Boot or standard Java",
          confidence: 0,
        },
      ],
    };
  }

  // Single result with high confidence AND single framework - no ambiguity
  if (results.length === 1 && results[0].confidence >= 0.8 && results[0].frameworks.length <= 1) {
    return {
      hasAmbiguity: false,
      type: "multiple_languages",
      message: "Project type detected successfully",
      options: [],
    };
  }

  // Multiple languages detected
  if (results.length > 1) {
    const options = results.map((result, index) => ({
      id: `${result.language}-${index}`,
      label: `${result.language.charAt(0).toUpperCase() + result.language.slice(1)}${result.frameworks.length > 0 ? ` (${result.frameworks.join(", ")})` : ""}`,
      description: `${result.language} project${result.frameworks.length > 0 ? ` with ${result.frameworks.join(", ")} framework${result.frameworks.length > 1 ? "s" : ""}` : ""} - detected from ${result.detectedFiles.join(", ")}`,
      confidence: result.confidence,
      recommended: result.confidence === Math.max(...results.map(r => r.confidence)),
    }));

    const highestConfidence = Math.max(...results.map(r => r.confidence));
    const recommendedResults = results.filter(r => r.confidence === highestConfidence);

    return {
      hasAmbiguity: true,
      type: "multiple_languages",
      message: "Multiple project types detected. Please choose the primary language/framework you want to instrument with Sentry:",
      options,
      recommendation: recommendedResults.length === 1 
        ? `I recommend ${recommendedResults[0].language} (${recommendedResults[0].confidence * 100}% confidence) based on the detected files.`
        : undefined,
    };
  }

  // Single result with low confidence
  const result = results[0];
  if (result.confidence < 0.8) {
    return {
      hasAmbiguity: true,
      type: "low_confidence",
      message: `Detected ${result.language} project but with low confidence (${Math.round(result.confidence * 100)}%). Please confirm or choose a different option:`,
      options: [
        {
          id: `${result.language}-confirmed`,
          label: `Yes, ${result.language.charAt(0).toUpperCase() + result.language.slice(1)}${result.frameworks.length > 0 ? ` with ${result.frameworks.join(", ")}` : ""}`,
          description: `Confirm ${result.language} project${result.frameworks.length > 0 ? ` with ${result.frameworks.join(", ")} framework${result.frameworks.length > 1 ? "s" : ""}` : ""}`,
          confidence: result.confidence,
          recommended: true,
        },
        {
          id: "javascript",
          label: "JavaScript/Node.js",
          description: "JavaScript project with Node.js runtime",
          confidence: 0,
        },
        {
          id: "python",
          label: "Python",
          description: "Python project with Django, Flask, or FastAPI",
          confidence: 0,
        },
        {
          id: "go",
          label: "Go",
          description: "Go project with Gin, Echo, or standard library",
          confidence: 0,
        },
      ],
    };
  }

  // Multiple frameworks within same language
  if (result.frameworks.length > 1) {
    const options = result.frameworks.map(framework => ({
      id: `${result.language}-${framework}`,
      label: `${result.language.charAt(0).toUpperCase() + result.language.slice(1)} with ${framework}`,
      description: `Focus on ${framework} framework for Sentry instrumentation`,
      confidence: result.confidence,
    }));

    return {
      hasAmbiguity: true,
      type: "multiple_frameworks",
      message: `Detected ${result.language} project with multiple frameworks: ${result.frameworks.join(", ")}. Which framework should be the primary focus for Sentry instrumentation?`,
      options,
      recommendation: "You can set up Sentry for multiple frameworks, but I recommend starting with your main application framework.",
    };
  }

  // No ambiguity
  return {
    hasAmbiguity: false,
    type: "multiple_languages",
    message: "Project type detected successfully",
    options: [],
  };
}

/**
 * Generate user-friendly ambiguity resolution prompt
 */
export function generateAmbiguityPrompt(ambiguity: AmbiguityResolution): string {
  if (!ambiguity.hasAmbiguity) {
    return "";
  }

  let prompt = `## ${ambiguity.message}\n\n`;

  if (ambiguity.options.length > 0) {
    prompt += "**Available options:**\n\n";
    ambiguity.options.forEach((option, index) => {
      const recommendedMark = option.recommended ? " ⭐ **Recommended**" : "";
      const confidenceMark = option.confidence > 0 ? ` (${Math.round(option.confidence * 100)}% confidence)` : "";
      
      prompt += `${index + 1}. **${option.label}**${recommendedMark}${confidenceMark}\n`;
      prompt += `   ${option.description}\n\n`;
    });
  }

  if (ambiguity.recommendation) {
    prompt += `**Recommendation:** ${ambiguity.recommendation}\n\n`;
  }

  prompt += "Please specify which option you'd like to proceed with, or provide additional context about your project setup.";

  return prompt;
}

/**
 * Resolve ambiguity by selecting a specific option
 */
export function resolveAmbiguity(
  results: ProjectDetectionResult[],
  selectedOptionId: string
): ProjectDetectionResult | null {
  // Handle confirmed low confidence cases
  if (selectedOptionId.endsWith("-confirmed")) {
    return results.length > 0 ? results[0] : null;
  }

  // Handle language-framework combinations
  if (selectedOptionId.includes("-")) {
    const [language, framework] = selectedOptionId.split("-");
    const result = results.find(r => r.language === language);
    
    if (result && framework && result.frameworks.includes(framework)) {
      return {
        ...result,
        frameworks: [framework], // Focus on single framework
      };
    }
  }

  // Handle direct language matches
  const result = results.find(r => r.language === selectedOptionId);
  if (result) {
    return result;
  }

  // Handle manual language selection (when no detection occurred)
  if (results.length === 0) {
    return {
      language: selectedOptionId,
      frameworks: [],
      confidence: 0.5, // Manual selection gets medium confidence
      detectedFiles: [],
      projectRoot: process.cwd(),
    };
  }

  return null;
}

/**
 * Main function to detect project language and frameworks
 */
export async function detectProject(targetDirectory?: string): Promise<ProjectDetectionResult[]> {
  const projectRoot = targetDirectory 
    ? path.resolve(targetDirectory)
    : await FileSystemUtils.findProjectRoot();

  const results: ProjectDetectionResult[] = [];
  const detectedFiles: string[] = [];

  // Check for JavaScript/TypeScript
  if (await FileSystemUtils.fileExists(path.join(projectRoot, "package.json"))) {
    detectedFiles.push("package.json");
    const frameworks = await scanPackageJson(projectRoot);
    
    // Determine if TypeScript based on tsconfig.json or TypeScript dependencies
    const hasTypeScript = await FileSystemUtils.fileExists(path.join(projectRoot, "tsconfig.json"));
    const packageJson = await FileSystemUtils.readJsonFile(path.join(projectRoot, "package.json"));
    const hasTypescriptDep = packageJson?.dependencies?.typescript || packageJson?.devDependencies?.typescript;

    const language = hasTypeScript || hasTypescriptDep ? "typescript" : "javascript";
    
    results.push({
      language,
      frameworks: frameworks.map(f => f.name),
      confidence: frameworks.length > 0 ? Math.max(...frameworks.map(f => f.confidence)) : 0.8,
      detectedFiles,
      projectRoot,
    });
  }

  // Check for Python
  if (await FileSystemUtils.fileExists(path.join(projectRoot, "requirements.txt"))) {
    detectedFiles.push("requirements.txt");
    const frameworks = await scanRequirementsTxt(projectRoot);
    
    results.push({
      language: "python",
      frameworks: frameworks.map(f => f.name),
      confidence: frameworks.length > 0 ? Math.max(...frameworks.map(f => f.confidence)) : 0.8,
      detectedFiles,
      projectRoot,
    });
  }

  // Check for Go
  if (await FileSystemUtils.fileExists(path.join(projectRoot, "go.mod"))) {
    detectedFiles.push("go.mod");
    const frameworks = await scanGoMod(projectRoot);
    
    results.push({
      language: "go",
      frameworks: frameworks.map(f => f.name),
      confidence: frameworks.length > 0 ? Math.max(...frameworks.map(f => f.confidence)) : 0.8,
      detectedFiles,
      projectRoot,
    });
  }

  // Check for Java
  if (await FileSystemUtils.fileExists(path.join(projectRoot, "pom.xml"))) {
    detectedFiles.push("pom.xml");
    const frameworks = await scanPomXml(projectRoot);
    
    results.push({
      language: "java",
      frameworks: frameworks.map(f => f.name),
      confidence: frameworks.length > 0 ? Math.max(...frameworks.map(f => f.confidence)) : 0.8,
      detectedFiles,
      projectRoot,
    });
  }

  // Check for Rust
  if (await FileSystemUtils.fileExists(path.join(projectRoot, "Cargo.toml"))) {
    detectedFiles.push("Cargo.toml");
    const frameworks = await scanCargoToml(projectRoot);
    
    results.push({
      language: "rust",
      frameworks: frameworks.map(f => f.name),
      confidence: frameworks.length > 0 ? Math.max(...frameworks.map(f => f.confidence)) : 0.8,
      detectedFiles,
      projectRoot,
    });
  }

  return results;
}

/**
 * Complete project detection with ambiguity analysis
 * This is the main entry point for project detection
 */
export async function detectProjectWithAmbiguityCheck(
  targetDirectory?: string
): Promise<{
  results: ProjectDetectionResult[];
  ambiguity: AmbiguityResolution;
}> {
  const results = await detectProject(targetDirectory);
  const ambiguity = analyzeDetectionAmbiguity(results);
  
  return {
    results,
    ambiguity,
  };
} 
