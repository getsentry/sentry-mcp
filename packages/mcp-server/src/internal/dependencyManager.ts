/**
 * Dependency management utilities for adding Sentry SDKs to projects.
 *
 * Handles modification of package manager files (package.json, requirements.txt,
 * go.mod, pom.xml, etc.) to add Sentry dependencies while preserving existing
 * structure, formatting, and comments.
 */
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { FileSystemUtils } from "./projectDetection";

/**
 * Schema for dependency addition request
 */
export const DependencyAdditionRequestSchema = z.object({
  manager: z.enum(["npm", "yarn", "pnpm", "pip", "poetry", "go", "maven", "gradle", "nuget", "composer", "bundle"]),
  packages: z.array(z.string()),
  devDependencies: z.boolean().optional(),
  version: z.string().optional(),
  projectRoot: z.string(),
});

export type DependencyAdditionRequest = z.infer<typeof DependencyAdditionRequestSchema>;

/**
 * Schema for dependency addition result
 */
export const DependencyAdditionResultSchema = z.object({
  success: z.boolean(),
  manager: z.string(),
  packagesAdded: z.array(z.string()),
  filesModified: z.array(z.string()),
  backupFiles: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  installCommand: z.string().optional(),
});

export type DependencyAdditionResult = z.infer<typeof DependencyAdditionResultSchema>;

/**
 * Schema for existing dependency detection
 */
export const ExistingDependencySchema = z.object({
  name: z.string(),
  version: z.string(),
  type: z.enum(["dependency", "devDependency", "peerDependency"]),
  location: z.string(),
});

export type ExistingDependency = z.infer<typeof ExistingDependencySchema>;

/**
 * Custom error for dependency management operations
 */
export class DependencyManagerError extends Error {
  constructor(
    message: string,
    public manager: string,
    public operation: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = "DependencyManagerError";
  }
}

/**
 * Base class for package manager handlers
 */
abstract class PackageManagerHandler {
  abstract name: string;
  abstract configFiles: string[];

  abstract detectExistingDependencies(projectRoot: string): Promise<ExistingDependency[]>;
  abstract addDependencies(request: DependencyAdditionRequest): Promise<DependencyAdditionResult>;
  abstract getInstallCommand(packages: string[], devDependencies?: boolean): string;

  /**
   * Create backup of a file before modification
   */
  protected async createBackup(filePath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.backup-${timestamp}`;
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  }

  /**
   * Check if a file exists
   */
  protected async fileExists(filePath: string): Promise<boolean> {
    return FileSystemUtils.fileExists(filePath);
  }
}

/**
 * Handler for npm/yarn/pnpm (package.json)
 */
export class NpmPackageManagerHandler extends PackageManagerHandler {
  name = "npm";
  configFiles = ["package.json"];

  async detectExistingDependencies(projectRoot: string): Promise<ExistingDependency[]> {
    const packageJsonPath = path.join(projectRoot, "package.json");
    const packageJson = await FileSystemUtils.readJsonFile(packageJsonPath);
    
    if (!packageJson) {
      return [];
    }

    const dependencies: ExistingDependency[] = [];

    // Check regular dependencies
    if (packageJson.dependencies) {
      for (const [name, version] of Object.entries(packageJson.dependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: "dependency",
          location: packageJsonPath,
        });
      }
    }

    // Check dev dependencies
    if (packageJson.devDependencies) {
      for (const [name, version] of Object.entries(packageJson.devDependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: "devDependency",
          location: packageJsonPath,
        });
      }
    }

    // Check peer dependencies
    if (packageJson.peerDependencies) {
      for (const [name, version] of Object.entries(packageJson.peerDependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: "peerDependency",
          location: packageJsonPath,
        });
      }
    }

    return dependencies;
  }

  async addDependencies(request: DependencyAdditionRequest): Promise<DependencyAdditionResult> {
    const { packages, devDependencies = false, version, projectRoot } = request;
    const packageJsonPath = path.join(projectRoot, "package.json");

    try {
      // Check if package.json exists
      if (!(await this.fileExists(packageJsonPath))) {
        throw new Error("package.json not found");
      }

      // Create backup
      const backupPath = await this.createBackup(packageJsonPath);

      // Read and parse package.json
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);

      // Determine target section
      const targetSection = devDependencies ? "devDependencies" : "dependencies";
      
      // Initialize section if it doesn't exist
      if (!packageJson[targetSection]) {
        packageJson[targetSection] = {};
      }

      // Add packages
      const packagesAdded: string[] = [];
      for (const pkg of packages) {
        const packageVersion = version || "latest";
        packageJson[targetSection][pkg] = packageVersion;
        packagesAdded.push(`${pkg}@${packageVersion}`);
      }

      // Write back to file with proper formatting
      const updatedContent = JSON.stringify(packageJson, null, 2) + "\n";
      await fs.writeFile(packageJsonPath, updatedContent, "utf-8");

      return {
        success: true,
        manager: this.name,
        packagesAdded,
        filesModified: [packageJsonPath],
        backupFiles: [backupPath],
        installCommand: this.getInstallCommand(packages, devDependencies),
      };
    } catch (error) {
      throw new DependencyManagerError(
        `Failed to add dependencies to package.json`,
        this.name,
        "addDependencies",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  getInstallCommand(packages: string[], devDependencies = false): string {
    const devFlag = devDependencies ? " --save-dev" : "";
    return `npm install${devFlag} ${packages.join(" ")}`;
  }
}

/**
 * Handler for pip (requirements.txt)
 */
export class PipPackageManagerHandler extends PackageManagerHandler {
  name = "pip";
  configFiles = ["requirements.txt", "requirements-dev.txt"];

  async detectExistingDependencies(projectRoot: string): Promise<ExistingDependency[]> {
    const dependencies: ExistingDependency[] = [];
    
    for (const configFile of this.configFiles) {
      const filePath = path.join(projectRoot, configFile);
      const content = await FileSystemUtils.readTextFile(filePath);
      
      if (!content) continue;

      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          // Parse requirement line (e.g., "package==1.0.0" or "package>=1.0.0")
          const match = trimmed.match(/^([a-zA-Z0-9_-]+[a-zA-Z0-9._-]*)(.*)?$/);
          if (match) {
            dependencies.push({
              name: match[1],
              version: match[2] || "",
              type: "dependency",
              location: filePath,
            });
          }
        }
      }
    }

    return dependencies;
  }

  async addDependencies(request: DependencyAdditionRequest): Promise<DependencyAdditionResult> {
    const { packages, devDependencies = false, version, projectRoot } = request;
    const targetFile = devDependencies ? "requirements-dev.txt" : "requirements.txt";
    const filePath = path.join(projectRoot, targetFile);

    try {
      let backupPath: string | undefined;
      let content = "";

      // Check if file exists, create backup if it does
      if (await this.fileExists(filePath)) {
        backupPath = await this.createBackup(filePath);
        content = await fs.readFile(filePath, "utf-8");
      }

      // Add packages to content
      const packagesAdded: string[] = [];
      for (const pkg of packages) {
        const packageSpec = version ? `${pkg}==${version}` : pkg;
        content += `${packageSpec}\n`;
        packagesAdded.push(packageSpec);
      }

      // Write updated content
      await fs.writeFile(filePath, content, "utf-8");

      return {
        success: true,
        manager: this.name,
        packagesAdded,
        filesModified: [filePath],
        backupFiles: backupPath ? [backupPath] : undefined,
        installCommand: this.getInstallCommand(packages, devDependencies),
      };
    } catch (error) {
      throw new DependencyManagerError(
        `Failed to add dependencies to ${targetFile}`,
        this.name,
        "addDependencies",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  getInstallCommand(packages: string[], devDependencies = false): string {
    const targetFile = devDependencies ? "requirements-dev.txt" : "requirements.txt";
    return `pip install -r ${targetFile}`;
  }
}

/**
 * Handler for Poetry (pyproject.toml)
 */
export class PoetryPackageManagerHandler extends PackageManagerHandler {
  name = "poetry";
  configFiles = ["pyproject.toml"];

  async detectExistingDependencies(projectRoot: string): Promise<ExistingDependency[]> {
    const pyprojectPath = path.join(projectRoot, "pyproject.toml");
    const content = await FileSystemUtils.readTextFile(pyprojectPath);
    
    if (!content) {
      return [];
    }

    const dependencies: ExistingDependency[] = [];

    // Simple TOML parsing for dependencies section
    const lines = content.split("\n");
    let inDependencies = false;
    let inDevDependencies = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === "[tool.poetry.dependencies]") {
        inDependencies = true;
        inDevDependencies = false;
        continue;
      }
      
      if (trimmed === "[tool.poetry.group.dev.dependencies]" || trimmed === "[tool.poetry.dev-dependencies]") {
        inDependencies = false;
        inDevDependencies = true;
        continue;
      }
      
      if (trimmed.startsWith("[")) {
        inDependencies = false;
        inDevDependencies = false;
        continue;
      }

      if ((inDependencies || inDevDependencies) && trimmed.includes("=")) {
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"?([^"]+)"?/);
        if (match && match[1] !== "python") {
          dependencies.push({
            name: match[1],
            version: match[2],
            type: inDevDependencies ? "devDependency" : "dependency",
            location: pyprojectPath,
          });
        }
      }
    }

    return dependencies;
  }

  async addDependencies(request: DependencyAdditionRequest): Promise<DependencyAdditionResult> {
    const { packages, devDependencies = false, version = "^0.0.0", projectRoot } = request;
    const pyprojectPath = path.join(projectRoot, "pyproject.toml");

    try {
      if (!(await this.fileExists(pyprojectPath))) {
        throw new Error("pyproject.toml not found");
      }

      const backupPath = await this.createBackup(pyprojectPath);
      let content = await fs.readFile(pyprojectPath, "utf-8");

      const packagesAdded: string[] = [];
      
      // Add each package to the appropriate section
      for (const pkg of packages) {
        const packageLine = `${pkg} = "${version}"`;
        
        if (devDependencies) {
          // Add to dev dependencies section
          if (content.includes("[tool.poetry.group.dev.dependencies]")) {
            content = content.replace(
              /(\[tool\.poetry\.group\.dev\.dependencies\])/,
              `$1\n${packageLine}`
            );
          } else if (content.includes("[tool.poetry.dev-dependencies]")) {
            content = content.replace(
              /(\[tool\.poetry\.dev-dependencies\])/,
              `$1\n${packageLine}`
            );
          } else {
            // Add dev dependencies section
            content += `\n[tool.poetry.group.dev.dependencies]\n${packageLine}\n`;
          }
        } else {
          // Add to regular dependencies section
          if (content.includes("[tool.poetry.dependencies]")) {
            content = content.replace(
              /(\[tool\.poetry\.dependencies\])/,
              `$1\n${packageLine}`
            );
          } else {
            // Add dependencies section
            content += `\n[tool.poetry.dependencies]\npython = "^3.8"\n${packageLine}\n`;
          }
        }
        
        packagesAdded.push(`${pkg}@${version}`);
      }

      await fs.writeFile(pyprojectPath, content, "utf-8");

      return {
        success: true,
        manager: this.name,
        packagesAdded,
        filesModified: [pyprojectPath],
        backupFiles: [backupPath],
        installCommand: this.getInstallCommand(packages, devDependencies),
      };
    } catch (error) {
      throw new DependencyManagerError(
        `Failed to add dependencies to pyproject.toml`,
        this.name,
        "addDependencies",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  getInstallCommand(packages: string[], devDependencies = false): string {
    const devFlag = devDependencies ? " --group dev" : "";
    return `poetry add${devFlag} ${packages.join(" ")}`;
  }
}

/**
 * Handler for Go modules (go.mod)
 */
export class GoModPackageManagerHandler extends PackageManagerHandler {
  name = "go";
  configFiles = ["go.mod"];

  async detectExistingDependencies(projectRoot: string): Promise<ExistingDependency[]> {
    const goModPath = path.join(projectRoot, "go.mod");
    const content = await FileSystemUtils.readTextFile(goModPath);
    
    if (!content) {
      return [];
    }

    const dependencies: ExistingDependency[] = [];
    const lines = content.split("\n");
    let inRequire = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === "require (") {
        inRequire = true;
        continue;
      }
      
      if (inRequire && trimmed === ")") {
        inRequire = false;
        continue;
      }

      if (inRequire || (trimmed.startsWith("require ") && !trimmed.includes("("))) {
        const match = trimmed.replace("require ", "").match(/^([^\s]+)\s+([^\s]+)/);
        if (match) {
          dependencies.push({
            name: match[1],
            version: match[2],
            type: "dependency",
            location: goModPath,
          });
        }
      }
    }

    return dependencies;
  }

  async addDependencies(request: DependencyAdditionRequest): Promise<DependencyAdditionResult> {
    const { packages, projectRoot } = request;

    // For Go modules, we don't directly modify go.mod
    // Instead, we use `go get` command which will update go.mod automatically
    const packagesAdded = packages.map(pkg => `${pkg}@latest`);

    return {
      success: true,
      manager: this.name,
      packagesAdded,
      filesModified: [], // go get will modify go.mod
      installCommand: this.getInstallCommand(packages),
    };
  }

  getInstallCommand(packages: string[]): string {
    return `go get ${packages.join(" ")}`;
  }
}

/**
 * Handler for Maven (pom.xml)
 */
export class MavenPackageManagerHandler extends PackageManagerHandler {
  name = "maven";
  configFiles = ["pom.xml"];

  async detectExistingDependencies(projectRoot: string): Promise<ExistingDependency[]> {
    const pomPath = path.join(projectRoot, "pom.xml");
    const content = await FileSystemUtils.readTextFile(pomPath);
    
    if (!content) {
      return [];
    }

    const dependencies: ExistingDependency[] = [];
    
    // Simple XML parsing for dependencies
    const dependencyMatches = content.matchAll(/<dependency>(.*?)<\/dependency>/gs);
    
    for (const match of dependencyMatches) {
      const depContent = match[1];
      const groupIdMatch = depContent.match(/<groupId>(.*?)<\/groupId>/);
      const artifactIdMatch = depContent.match(/<artifactId>(.*?)<\/artifactId>/);
      const versionMatch = depContent.match(/<version>(.*?)<\/version>/);
      
      if (groupIdMatch && artifactIdMatch) {
        dependencies.push({
          name: `${groupIdMatch[1]}:${artifactIdMatch[1]}`,
          version: versionMatch ? versionMatch[1] : "",
          type: "dependency",
          location: pomPath,
        });
      }
    }

    return dependencies;
  }

  async addDependencies(request: DependencyAdditionRequest): Promise<DependencyAdditionResult> {
    const { packages, version = "6.28.0", projectRoot } = request;
    const pomPath = path.join(projectRoot, "pom.xml");

    try {
      if (!(await this.fileExists(pomPath))) {
        throw new Error("pom.xml not found");
      }

      const backupPath = await this.createBackup(pomPath);
      let content = await fs.readFile(pomPath, "utf-8");

      const packagesAdded: string[] = [];

      for (const pkg of packages) {
        // Parse package (e.g., "io.sentry:sentry-spring-boot-starter")
        const [groupId, artifactId] = pkg.split(":");
        
        const dependencyXml = `
        <dependency>
            <groupId>${groupId}</groupId>
            <artifactId>${artifactId}</artifactId>
            <version>${version}</version>
        </dependency>`;

        // Add to dependencies section
        if (content.includes("<dependencies>")) {
          content = content.replace(
            /(<dependencies>)/,
            `$1${dependencyXml}`
          );
        } else {
          // Add dependencies section before </project>
          content = content.replace(
            /(<\/project>)/,
            `    <dependencies>${dependencyXml}\n    </dependencies>\n$1`
          );
        }

        packagesAdded.push(`${pkg}:${version}`);
      }

      await fs.writeFile(pomPath, content, "utf-8");

      return {
        success: true,
        manager: this.name,
        packagesAdded,
        filesModified: [pomPath],
        backupFiles: [backupPath],
        installCommand: this.getInstallCommand(packages),
      };
    } catch (error) {
      throw new DependencyManagerError(
        `Failed to add dependencies to pom.xml`,
        this.name,
        "addDependencies",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  getInstallCommand(packages: string[]): string {
    return "mvn clean install";
  }
}

/**
 * Main dependency manager orchestrator
 */
export class DependencyManager {
  private handlers: Map<string, PackageManagerHandler> = new Map();

  constructor() {
    // Register all package manager handlers
    this.registerHandler(new NpmPackageManagerHandler());
    this.registerHandler(new PipPackageManagerHandler());
    this.registerHandler(new PoetryPackageManagerHandler());
    this.registerHandler(new GoModPackageManagerHandler());
    this.registerHandler(new MavenPackageManagerHandler());
  }

  private registerHandler(handler: PackageManagerHandler): void {
    this.handlers.set(handler.name, handler);
  }

  /**
   * Get handler for a specific package manager
   */
  getHandler(manager: string): PackageManagerHandler | null {
    return this.handlers.get(manager) || null;
  }

  /**
   * Detect existing Sentry dependencies across all package managers
   */
  async detectExistingSentryDependencies(projectRoot: string): Promise<ExistingDependency[]> {
    const allDependencies: ExistingDependency[] = [];

    for (const handler of this.handlers.values()) {
      try {
        const dependencies = await handler.detectExistingDependencies(projectRoot);
        const sentryDependencies = dependencies.filter(dep => 
          dep.name.toLowerCase().includes("sentry")
        );
        allDependencies.push(...sentryDependencies);
      } catch (error) {
        // Continue checking other handlers even if one fails
        console.warn(`Failed to detect dependencies for ${handler.name}:`, error);
      }
    }

    return allDependencies;
  }

  /**
   * Add dependencies using the appropriate package manager
   */
  async addDependencies(request: DependencyAdditionRequest): Promise<DependencyAdditionResult> {
    const handler = this.getHandler(request.manager);
    
    if (!handler) {
      throw new DependencyManagerError(
        `Unsupported package manager: ${request.manager}`,
        request.manager,
        "addDependencies",
      );
    }

    return handler.addDependencies(request);
  }

  /**
   * Get install command for a specific package manager
   */
  getInstallCommand(manager: string, packages: string[], devDependencies = false): string | null {
    const handler = this.getHandler(manager);
    return handler ? handler.getInstallCommand(packages, devDependencies) : null;
  }
} 
