import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import {
  detectProject,
  detectProjectWithAmbiguityCheck,
  scanPackageJson,
  scanRequirementsTxt,
  scanGoMod,
  scanPomXml,
  scanCargoToml,
  analyzeDetectionAmbiguity,
  generateAmbiguityPrompt,
  resolveAmbiguity,
  FileSystemUtils,
} from "./projectDetection";

// Mock fs/promises module
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

const mockFs = vi.mocked(fs);

describe("FileSystemUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fileExists", () => {
    it("should return true when file exists", async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await FileSystemUtils.fileExists("/test/package.json");
      expect(result).toBe(true);
    });

    it("should return false when file does not exist", async () => {
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const result = await FileSystemUtils.fileExists("/test/nonexistent.json");
      expect(result).toBe(false);
    });
  });

  describe("readJsonFile", () => {
    it("should parse valid JSON", async () => {
      const testData = { name: "test-project", dependencies: { react: "^18.0.0" } };
      mockFs.readFile.mockResolvedValue(JSON.stringify(testData));

      const result = await FileSystemUtils.readJsonFile("/test/package.json");
      expect(result).toEqual(testData);
    });

    it("should return null for invalid JSON", async () => {
      mockFs.readFile.mockResolvedValue("invalid json {");

      const result = await FileSystemUtils.readJsonFile("/test/invalid.json");
      expect(result).toBeNull();
    });

    it("should return null when file does not exist", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await FileSystemUtils.readJsonFile("/test/nonexistent.json");
      expect(result).toBeNull();
    });
  });

  describe("readTextFile", () => {
    it("should read text file content", async () => {
      const content = "Django==4.2.0\npsycopg2==2.9.0";
      mockFs.readFile.mockResolvedValue(content);

      const result = await FileSystemUtils.readTextFile("/test/requirements.txt");
      expect(result).toBe(content);
    });

    it("should return null when file does not exist", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await FileSystemUtils.readTextFile("/test/nonexistent.txt");
      expect(result).toBeNull();
    });
  });

  describe("findProjectRoot", () => {
    it("should find project root with package.json", async () => {
      // Mock that package.json exists in /home/user/project
      mockFs.access.mockImplementation((path: any) => {
        if (path.includes("/home/user/project/package.json")) {
          return Promise.resolve();
        }
        return Promise.reject(new Error("ENOENT"));
      });

      const result = await FileSystemUtils.findProjectRoot("/home/user/project/src");
      expect(result).toBe("/home/user/project");
    });

    it("should fallback to current directory", async () => {
      // Mock that no root indicators exist
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const result = await FileSystemUtils.findProjectRoot("/no/project/files");
      expect(result).toBe("/no/project/files");
    });
  });
});

describe("scanPackageJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect React project", async () => {
    const packageJson = {
      name: "test-react-app",
      dependencies: {
        react: "^18.0.0",
        "react-dom": "^18.0.0",
      },
      devDependencies: {
        "@types/react": "^18.0.0",
      },
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(packageJson));

    const result = await scanPackageJson("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "react",
      confidence: 0.95,
      evidence: ["react dependency", "@types/react dependency"],
    });
  });

  it("should detect Next.js project", async () => {
    const packageJson = {
      name: "test-nextjs-app",
      dependencies: {
        next: "^14.0.0",
        react: "^18.0.0",
      },
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(packageJson));

    const result = await scanPackageJson("/test/project");

    expect(result).toHaveLength(2);
    expect(result.find(f => f.name === "next")).toEqual({
      name: "next",
      confidence: 0.95,
      evidence: ["next dependency"],
    });
    expect(result.find(f => f.name === "react")).toEqual({
      name: "react",
      confidence: 0.95,
      evidence: ["react dependency"],
    });
  });

  it("should detect Vue project", async () => {
    const packageJson = {
      name: "test-vue-app",
      dependencies: {
        vue: "^3.0.0",
      },
      devDependencies: {
        "@vue/cli": "^5.0.0",
      },
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(packageJson));

    const result = await scanPackageJson("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "vue",
      confidence: 0.95,
      evidence: ["vue dependency", "@vue/cli dependency"],
    });
  });

  it("should detect Angular project", async () => {
    const packageJson = {
      name: "test-angular-app",
      dependencies: {
        "@angular/core": "^16.0.0",
        "@angular/common": "^16.0.0",
      },
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(packageJson));

    const result = await scanPackageJson("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "angular",
      confidence: 0.95,
      evidence: ["@angular/core dependency"],
    });
  });

  it("should detect Express project", async () => {
    const packageJson = {
      name: "test-express-app",
      dependencies: {
        express: "^4.18.0",
      },
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(packageJson));

    const result = await scanPackageJson("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "express",
      confidence: 0.9,
      evidence: ["express dependency"],
    });
  });

  it("should return empty array when package.json not found", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await scanPackageJson("/test/project");

    expect(result).toEqual([]);
  });

  it("should handle package.json without dependencies", async () => {
    const packageJson = {
      name: "test-empty-app",
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(packageJson));

    const result = await scanPackageJson("/test/project");

    expect(result).toEqual([]);
  });
});

describe("scanRequirementsTxt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect Django project", async () => {
    const content = "Django==4.2.0\npsycopg2==2.9.0\ncelery==5.3.0";
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanRequirementsTxt("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "django",
      confidence: 0.95,
      evidence: ["django in requirements.txt"],
    });
  });

  it("should detect Flask project", async () => {
    const content = "Flask==2.3.0\nFlask-SQLAlchemy==3.0.0\ngunicorn==21.0.0";
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanRequirementsTxt("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "flask",
      confidence: 0.95,
      evidence: ["flask in requirements.txt"],
    });
  });

  it("should detect FastAPI project", async () => {
    const content = "fastapi==0.104.0\nuvicorn==0.24.0\npydantic==2.5.0";
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanRequirementsTxt("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "fastapi",
      confidence: 0.95,
      evidence: ["fastapi in requirements.txt"],
    });
  });

  it("should detect multiple frameworks", async () => {
    const content = "Django==4.2.0\nFastAPI==0.104.0\nFlask==2.3.0";
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanRequirementsTxt("/test/project");

    expect(result).toHaveLength(3);
    expect(result.map(r => r.name)).toEqual(["django", "flask", "fastapi"]);
  });

  it("should handle case insensitive matching", async () => {
    const content = "django==4.2.0\nFLASK==2.3.0\nFastApi==0.104.0";
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanRequirementsTxt("/test/project");

    expect(result).toHaveLength(3);
    expect(result.map(r => r.name)).toEqual(["django", "flask", "fastapi"]);
  });

  it("should ignore comments and empty lines", async () => {
    const content = `# Python dependencies
Django==4.2.0

# Database
psycopg2==2.9.0
# Web server
gunicorn==21.0.0`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanRequirementsTxt("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("django");
  });

  it("should return empty array when file not found", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await scanRequirementsTxt("/test/project");

    expect(result).toEqual([]);
  });
});

describe("scanGoMod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect Gin framework", async () => {
    const content = `module test-app

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/stretchr/testify v1.8.4
)`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanGoMod("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "gin",
      confidence: 0.95,
      evidence: ["gin framework in go.mod"],
    });
  });

  it("should detect Echo framework", async () => {
    const content = `module test-app

go 1.21

require (
    github.com/labstack/echo v3.3.10
    github.com/labstack/echo/v4 v4.11.1
)`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanGoMod("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "echo",
      confidence: 0.95,
      evidence: ["echo framework in go.mod"],
    });
  });

  it("should detect both Gin and Echo", async () => {
    const content = `module test-app

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/labstack/echo/v4 v4.11.1
)`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanGoMod("/test/project");

    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(["gin", "echo"]);
  });

  it("should handle single-line require statements", async () => {
    const content = `module test-app

go 1.21

require github.com/gin-gonic/gin v1.9.1`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanGoMod("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("gin");
  });

  it("should return empty array when file not found", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await scanGoMod("/test/project");

    expect(result).toEqual([]);
  });

  it("should return empty array when no frameworks detected", async () => {
    const content = `module test-app

go 1.21

require (
    github.com/stretchr/testify v1.8.4
)`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanGoMod("/test/project");

    expect(result).toEqual([]);
  });
});

describe("scanPomXml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect Spring Boot project", async () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <groupId>com.example</groupId>
    <artifactId>demo</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
            <version>3.1.0</version>
        </dependency>
    </dependencies>
</project>`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanPomXml("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "spring",
      confidence: 0.95,
      evidence: ["spring framework in pom.xml"],
    });
  });

  it("should detect Spring framework", async () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-context</artifactId>
            <version>6.0.0</version>
        </dependency>
    </dependencies>
</project>`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanPomXml("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "spring",
      confidence: 0.95,
      evidence: ["spring framework in pom.xml"],
    });
  });

  it("should handle dependencies without version", async () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
    </dependencies>
</project>`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanPomXml("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "spring",
      confidence: 0.95,
      evidence: ["spring framework in pom.xml"],
    });
  });

  it("should return empty array when file not found", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await scanPomXml("/test/project");

    expect(result).toEqual([]);
  });
});

describe("scanCargoToml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect Rust project", async () => {
    const content = `[package]
name = "test-rust-app"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanCargoToml("/test/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "rust",
      confidence: 0.9,
      evidence: ["Cargo.toml detected"],
    });
  });

  it("should return empty array when file not found", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await scanCargoToml("/test/project");

    expect(result).toEqual([]);
  });

  it("should return empty array when no [package] section", async () => {
    const content = `[dependencies]
serde = "1.0"`;
    mockFs.readFile.mockResolvedValue(content);

    const result = await scanCargoToml("/test/project");

    expect(result).toEqual([]);
  });
});

describe("analyzeDetectionAmbiguity", () => {
  it("should return no ambiguity for single high-confidence result", () => {
    const results = [
      {
        language: "javascript",
        frameworks: ["react"],
        confidence: 0.95,
        detectedFiles: ["package.json"],
        projectRoot: "/test",
      },
    ];

    const ambiguity = analyzeDetectionAmbiguity(results);

    expect(ambiguity.hasAmbiguity).toBe(false);
    expect(ambiguity.type).toBe("multiple_languages");
  });

  it("should detect multiple languages ambiguity", () => {
    const results = [
      {
        language: "javascript",
        frameworks: ["react"],
        confidence: 0.9,
        detectedFiles: ["package.json"],
        projectRoot: "/test",
      },
      {
        language: "python",
        frameworks: ["django"],
        confidence: 0.85,
        detectedFiles: ["requirements.txt"],
        projectRoot: "/test",
      },
    ];

    const ambiguity = analyzeDetectionAmbiguity(results);

    expect(ambiguity.hasAmbiguity).toBe(true);
    expect(ambiguity.type).toBe("multiple_languages");
    expect(ambiguity.options).toHaveLength(2);
    expect(ambiguity.options[0].recommended).toBe(true);
    expect(ambiguity.options[1].recommended).toBe(false);
  });

  it("should detect low confidence ambiguity", () => {
    const results = [
      {
        language: "javascript",
        frameworks: ["react"],
        confidence: 0.6,
        detectedFiles: ["package.json"],
        projectRoot: "/test",
      },
    ];

    const ambiguity = analyzeDetectionAmbiguity(results);

    expect(ambiguity.hasAmbiguity).toBe(true);
    expect(ambiguity.type).toBe("low_confidence");
    expect(ambiguity.message).toContain("(60%)");
  });

  it("should detect multiple frameworks ambiguity", () => {
    const results = [
      {
        language: "javascript",
        frameworks: ["react", "vue"],
        confidence: 0.9,
        detectedFiles: ["package.json"],
        projectRoot: "/test",
      },
    ];

    const ambiguity = analyzeDetectionAmbiguity(results);

    expect(ambiguity.hasAmbiguity).toBe(true);
    expect(ambiguity.type).toBe("multiple_frameworks");
    expect(ambiguity.options).toHaveLength(2);
    expect(ambiguity.options[0].id).toBe("javascript-react");
    expect(ambiguity.options[1].id).toBe("javascript-vue");
  });

  it("should handle no results", () => {
    const results: any[] = [];

    const ambiguity = analyzeDetectionAmbiguity(results);

    expect(ambiguity.hasAmbiguity).toBe(true);
    expect(ambiguity.type).toBe("low_confidence");
    expect(ambiguity.message).toContain("No supported project files detected");
    expect(ambiguity.options.length).toBeGreaterThan(0);
  });
});

describe("generateAmbiguityPrompt", () => {
  it("should return empty string when no ambiguity", () => {
    const ambiguity = {
      hasAmbiguity: false,
      type: "multiple_languages" as const,
      message: "All good",
      options: [],
    };

    const prompt = generateAmbiguityPrompt(ambiguity);

    expect(prompt).toBe("");
  });

  it("should generate formatted prompt for multiple options", () => {
    const ambiguity = {
      hasAmbiguity: true,
      type: "multiple_languages" as const,
      message: "Multiple project types detected",
      options: [
        {
          id: "javascript",
          label: "JavaScript",
          description: "JavaScript project with Node.js",
          confidence: 0.9,
          recommended: true,
        },
        {
          id: "python",
          label: "Python",
          description: "Python project with Django",
          confidence: 0.8,
        },
      ],
      recommendation: "I recommend JavaScript",
    };

    const prompt = generateAmbiguityPrompt(ambiguity);

    expect(prompt).toContain("Multiple project types detected");
    expect(prompt).toContain("**Available options:**");
    expect(prompt).toContain("1. **JavaScript** ⭐ **Recommended** (90% confidence)");
    expect(prompt).toContain("2. **Python** (80% confidence)");
    expect(prompt).toContain("**Recommendation:** I recommend JavaScript");
  });
});

describe("resolveAmbiguity", () => {
  const testResults = [
    {
      language: "javascript",
      frameworks: ["react", "vue"],
      confidence: 0.9,
      detectedFiles: ["package.json"],
      projectRoot: "/test",
    },
  ];

  it("should resolve confirmed option", () => {
    const result = resolveAmbiguity(testResults, "javascript-confirmed");

    expect(result).toEqual(testResults[0]);
  });

  it("should resolve specific framework", () => {
    const result = resolveAmbiguity(testResults, "javascript-react");

    expect(result).toEqual({
      ...testResults[0],
      frameworks: ["react"],
    });
  });

  it("should resolve language match", () => {
    const result = resolveAmbiguity(testResults, "javascript");

    expect(result).toEqual(testResults[0]);
  });

  it("should handle manual selection with no results", () => {
    const result = resolveAmbiguity([], "python");

    expect(result).toEqual({
      language: "python",
      frameworks: [],
      confidence: 0.5,
      detectedFiles: [],
      projectRoot: process.cwd(),
    });
  });

  it("should return null for invalid selection", () => {
    const result = resolveAmbiguity(testResults, "invalid-selection");

    expect(result).toBeNull();
  });
}); 
