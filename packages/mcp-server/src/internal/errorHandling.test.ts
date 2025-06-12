import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserInputError } from "../errors";
import {
  SdkInstrumentationErrorHandler,
  ErrorRecoveryUtils,
  ProjectDetectionError,
  SdkContextError,
  InstrumentationError,
  type ErrorContext,
  type ValidationError,
} from "./errorHandling";

describe("ProjectDetectionError", () => {
  it("should create error with path and optional cause", () => {
    const cause = new Error("File not found");
    const error = new ProjectDetectionError("Detection failed", "/test/path", cause);

    expect(error.message).toBe("Detection failed");
    expect(error.path).toBe("/test/path");
    expect(error.cause).toBe(cause);
    expect(error.name).toBe("ProjectDetectionError");
  });
});

describe("SdkContextError", () => {
  it("should create error with framework and optional URL", () => {
    const error = new SdkContextError("Fetch failed", "react", "https://api.example.com");

    expect(error.message).toBe("Fetch failed");
    expect(error.framework).toBe("react");
    expect(error.url).toBe("https://api.example.com");
    expect(error.name).toBe("SdkContextError");
  });
});

describe("InstrumentationError", () => {
  it("should create error with framework and language", () => {
    const error = new InstrumentationError("Plan generation failed", "react", "javascript");

    expect(error.message).toBe("Plan generation failed");
    expect(error.framework).toBe("react");
    expect(error.language).toBe("javascript");
    expect(error.name).toBe("InstrumentationError");
  });
});

describe("SdkInstrumentationErrorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console.error to avoid noise in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("handleProjectDetectionError", () => {
    const context: ErrorContext = {
      operation: "project-detection",
      projectPath: "/test/project",
    };

    it("should handle ProjectDetectionError with user-friendly message", () => {
      const error = new ProjectDetectionError("Custom detection error", "/test/project");

      expect(() => {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      } catch (userError) {
        expect(userError).toBeInstanceOf(UserInputError);
        expect((userError as UserInputError).message).toContain("Failed to detect project type");
        expect((userError as UserInputError).message).toContain("/test/project");
        expect((userError as UserInputError).message).toContain("recognizable dependency files");
      }
    });

    it("should handle ENOENT file system error", () => {
      const error = new Error("ENOENT: no such file or directory");

      expect(() => {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("does not exist or is not accessible");
      }
    });

    it("should handle EACCES permission error", () => {
      const error = new Error("EACCES: permission denied");

      expect(() => {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("Permission denied");
      }
    });

    it("should handle unexpected errors with generic message", () => {
      const error = new Error("Unexpected system error");

      expect(() => {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleProjectDetectionError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("Unable to detect project type");
        expect((userError as UserInputError).message).toContain("valid project files");
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected error during project detection"),
        error
      );
    });
  });

  describe("handleSdkContextError", () => {
    const context: ErrorContext = {
      operation: "sdk-context-fetch",
      framework: "react",
    };

    it("should handle SdkContextError with fallback message", () => {
      const error = new SdkContextError("API unavailable", "react");

      expect(() => {
        SdkInstrumentationErrorHandler.handleSdkContextError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleSdkContextError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("Failed to fetch SDK context for react");
        expect((userError as UserInputError).message).toContain("built-in fallback configuration");
      }
    });

    it("should handle fetch errors with network guidance", () => {
      const error = new Error("fetch failed due to network");

      expect(() => {
        SdkInstrumentationErrorHandler.handleSdkContextError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleSdkContextError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("network issues");
        expect((userError as UserInputError).message).toContain("built-in SDK configuration");
      }
    });

    it("should handle timeout errors", () => {
      const error = new Error("Request timeout");

      expect(() => {
        SdkInstrumentationErrorHandler.handleSdkContextError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleSdkContextError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("timeout");
        expect((userError as UserInputError).message).toContain("cached or fallback configuration");
      }
    });
  });

  describe("handleInstrumentationError", () => {
    const context: ErrorContext = {
      operation: "instrumentation-planning",
      framework: "react",
      language: "javascript",
    };

    it("should handle InstrumentationError with specific details", () => {
      const error = new InstrumentationError("Template not found", "react", "javascript");

      expect(() => {
        SdkInstrumentationErrorHandler.handleInstrumentationError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleInstrumentationError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("javascript/react");
        expect((userError as UserInputError).message).toContain("Template not found");
      }
    });

    it("should re-throw UserInputError as-is", () => {
      const error = new UserInputError("Original user error");

      expect(() => {
        SdkInstrumentationErrorHandler.handleInstrumentationError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleInstrumentationError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toBe("Original user error");
      }
    });
  });

  describe("handleFileSystemError", () => {
    const context: ErrorContext = {
      operation: "file-read",
      projectPath: "/test/project",
    };

    it("should handle ENOENT with helpful message", () => {
      const error = new Error("ENOENT: file not found");

      expect(() => {
        SdkInstrumentationErrorHandler.handleFileSystemError(error, context, "/test/file.json");
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleFileSystemError(error, context, "/test/file.json");
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("/test/file.json");
        expect((userError as UserInputError).message).toContain("does not exist");
      }
    });

    it("should handle EISDIR error", () => {
      const error = new Error("EISDIR: illegal operation on a directory");

      expect(() => {
        SdkInstrumentationErrorHandler.handleFileSystemError(error, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleFileSystemError(error, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("Expected a file but found a directory");
      }
    });
  });

  describe("handleValidationErrors", () => {
    const context: ErrorContext = {
      operation: "validation",
    };

    it("should handle single validation error", () => {
      const errors: ValidationError[] = [
        {
          field: "dsn",
          message: "DSN is required",
          suggestion: "Get DSN from Sentry project settings",
        },
      ];

      expect(() => {
        SdkInstrumentationErrorHandler.handleValidationErrors(errors, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleValidationErrors(errors, context);
      } catch (userError) {
        expect((userError as UserInputError).message).toContain("Validation failed");
        expect((userError as UserInputError).message).toContain("dsn: DSN is required");
        expect((userError as UserInputError).message).toContain("Get DSN from Sentry project settings");
      }
    });

    it("should handle multiple validation errors", () => {
      const errors: ValidationError[] = [
        { field: "dsn", message: "DSN is required" },
        { field: "org", message: "Organization is required" },
      ];

      expect(() => {
        SdkInstrumentationErrorHandler.handleValidationErrors(errors, context);
      }).toThrow(UserInputError);

      try {
        SdkInstrumentationErrorHandler.handleValidationErrors(errors, context);
      } catch (userError) {
        const message = (userError as UserInputError).message;
        expect(message).toContain("dsn: DSN is required");
        expect(message).toContain("org: Organization is required");
      }
    });

    it("should not throw for empty errors array", () => {
      expect(() => {
        SdkInstrumentationErrorHandler.handleValidationErrors([], context);
      }).not.toThrow();
    });
  });

  describe("validateSentryConfig", () => {
    it("should return no errors for valid config", () => {
      const config = {
        dsn: "https://key@org.ingest.sentry.io/project",
        org: "test-org",
        project: "test-project",
        regionUrl: "https://us.sentry.io",
      };

      const errors = SdkInstrumentationErrorHandler.validateSentryConfig(config);
      expect(errors).toHaveLength(0);
    });

    it("should validate missing DSN", () => {
      const config = { org: "test-org", project: "test-project" };

      const errors = SdkInstrumentationErrorHandler.validateSentryConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe("dsn");
      expect(errors[0].message).toContain("required");
    });

    it("should validate invalid DSN format", () => {
      const config = {
        dsn: "invalid-dsn-format",
        org: "test-org",
        project: "test-project",
      };

      const errors = SdkInstrumentationErrorHandler.validateSentryConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe("dsn");
      expect(errors[0].message).toContain("format appears invalid");
    });

    it("should validate missing organization and project", () => {
      const config = {
        dsn: "https://key@org.ingest.sentry.io/project",
      };

      const errors = SdkInstrumentationErrorHandler.validateSentryConfig(config);
      expect(errors).toHaveLength(2);
      expect(errors.find(e => e.field === "org")).toBeDefined();
      expect(errors.find(e => e.field === "project")).toBeDefined();
    });

    it("should validate invalid region URL", () => {
      const config = {
        dsn: "https://key@org.ingest.sentry.io/project",
        org: "test-org",
        project: "test-project",
        regionUrl: "http://insecure.sentry.io",
      };

      const errors = SdkInstrumentationErrorHandler.validateSentryConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe("regionUrl");
      expect(errors[0].message).toContain("HTTPS URL");
    });
  });

  describe("withErrorHandling", () => {
    it("should execute operation successfully", async () => {
      const operation = vi.fn().mockResolvedValue("success");
      const context: ErrorContext = { operation: "test" };

      const result = await SdkInstrumentationErrorHandler.withErrorHandling(operation, context);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledOnce();
    });

    it("should handle project-detection errors", async () => {
      const error = new ProjectDetectionError("Detection failed", "/test");
      const operation = vi.fn().mockRejectedValue(error);
      const context: ErrorContext = { operation: "project-detection", projectPath: "/test" };

      await expect(
        SdkInstrumentationErrorHandler.withErrorHandling(operation, context)
      ).rejects.toThrow(UserInputError);
    });

    it("should handle unknown operation with generic error", async () => {
      const error = new Error("Unexpected error");
      const operation = vi.fn().mockRejectedValue(error);
      const context: ErrorContext = { operation: "unknown-operation" };

      await expect(
        SdkInstrumentationErrorHandler.withErrorHandling(operation, context)
      ).rejects.toThrow(UserInputError);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected error in unknown-operation"),
        error
      );
    });
  });
});

describe("ErrorRecoveryUtils", () => {
  describe("suggestRecoveryActions", () => {
    it("should suggest actions for ProjectDetectionError", () => {
      const error = new ProjectDetectionError("Detection failed", "/test");
      const context: ErrorContext = { operation: "project-detection" };

      const suggestions = ErrorRecoveryUtils.suggestRecoveryActions(error, context);

      expect(suggestions).toContain("Ensure you're in the root directory of your project");
      expect(suggestions).toContain("Check that dependency files exist (package.json, requirements.txt, etc.)");
      expect(suggestions).toContain("Verify file permissions allow reading project files");
    });

    it("should suggest actions for SdkContextError", () => {
      const error = new SdkContextError("Fetch failed", "react");
      const context: ErrorContext = { operation: "sdk-context-fetch" };

      const suggestions = ErrorRecoveryUtils.suggestRecoveryActions(error, context);

      expect(suggestions).toContain("Check your internet connection");
      expect(suggestions).toContain("Try again in a few minutes");
      expect(suggestions).toContain("Proceed with manual SDK setup using Sentry documentation");
    });

    it("should suggest actions for InstrumentationError", () => {
      const error = new InstrumentationError("Plan failed", "react", "javascript");
      const context: ErrorContext = { operation: "instrumentation-planning" };

      const suggestions = ErrorRecoveryUtils.suggestRecoveryActions(error, context);

      expect(suggestions).toContain("Verify your project uses a supported framework version");
      expect(suggestions).toContain("Check that all required project files are present");
    });

    it("should suggest actions for permission errors", () => {
      const error = new Error("Permission denied accessing file");
      const context: ErrorContext = { operation: "file-access" };

      const suggestions = ErrorRecoveryUtils.suggestRecoveryActions(error, context);

      expect(suggestions).toContain("Check file/directory permissions");
      expect(suggestions).toContain("Run the command with appropriate privileges");
    });

    it("should suggest actions for network errors", () => {
      const error = new Error("Network fetch failed");
      const context: ErrorContext = { operation: "network-request" };

      const suggestions = ErrorRecoveryUtils.suggestRecoveryActions(error, context);

      expect(suggestions).toContain("Check your internet connection");
      expect(suggestions).toContain("Verify firewall settings allow HTTPS requests");
    });

    it("should always include general suggestions", () => {
      const error = new Error("Generic error");
      const context: ErrorContext = { operation: "generic" };

      const suggestions = ErrorRecoveryUtils.suggestRecoveryActions(error, context);

      expect(suggestions).toContain("Review the error message for specific guidance");
      expect(suggestions).toContain("Consult the Sentry documentation for your platform");
      expect(suggestions).toContain("Reach out to Sentry support if issues persist");
    });
  });

  describe("formatErrorWithRecovery", () => {
    it("should format error with recovery suggestions", () => {
      const error = new ProjectDetectionError("Detection failed", "/test");
      const context: ErrorContext = { operation: "project-detection" };

      const formatted = ErrorRecoveryUtils.formatErrorWithRecovery(error, context);

      expect(formatted).toContain("Detection failed");
      expect(formatted).toContain("🔧 **Suggested actions:**");
      expect(formatted).toContain("• Ensure you're in the root directory");
      expect(formatted).toContain("• Check that dependency files exist");
    });

    it("should format error without recovery suggestions when none available", () => {
      const error = new Error("Simple error");
      const context: ErrorContext = { operation: "simple" };

      // Mock to return no specific suggestions
      vi.spyOn(ErrorRecoveryUtils, "suggestRecoveryActions").mockReturnValue([]);

      const formatted = ErrorRecoveryUtils.formatErrorWithRecovery(error, context);

      expect(formatted).toBe("Simple error");
      expect(formatted).not.toContain("🔧 **Suggested actions:**");
    });
  });
}); 
