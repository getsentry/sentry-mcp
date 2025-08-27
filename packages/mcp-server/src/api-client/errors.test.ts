import { describe, it, expect } from "vitest";
import {
  ApiError,
  ApiClientError,
  ApiServerError,
  ApiPermissionError,
  ApiNotFoundError,
  ApiValidationError,
  ApiAuthenticationError,
  ApiRateLimitError,
  createApiError,
} from "./errors";

describe("API Error Hierarchy", () => {
  describe("ApiClientError.toUserMessage", () => {
    it("formats error message with status code", () => {
      const error = new ApiClientError("Bad request", 400);
      expect(error.toUserMessage()).toBe("API error (400): Bad request");
    });

    it("works with specific error types", () => {
      const permissionError = new ApiPermissionError("No access");
      expect(permissionError.toUserMessage()).toBe(
        "API error (403): No access",
      );

      const notFoundError = new ApiNotFoundError("Resource not found");
      expect(notFoundError.toUserMessage()).toBe(
        "API error (404): Resource not found. Please verify that the organization, project, or resource ID is correct and that you have access to it.",
      );

      const rateLimitError = new ApiRateLimitError("Too many requests");
      expect(rateLimitError.toUserMessage()).toBe(
        "API error (429): Too many requests",
      );
    });

    it("adds helpful context for 404 errors", () => {
      // Generic 404 message gets detailed help
      const genericNotFound = new ApiNotFoundError(
        "The requested resource does not exist",
      );
      expect(genericNotFound.toUserMessage()).toBe(
        "API error (404): The requested resource does not exist. Please verify that the organization, project, or resource ID is correct and that you have access to it.",
      );

      // Specific 404 message gets brief hint
      const projectNotFound = new ApiNotFoundError("Project not found");
      expect(projectNotFound.toUserMessage()).toBe(
        "API error (404): Project not found. Please verify the parameters are correct.",
      );

      // Another generic variant
      const notFound = new ApiNotFoundError("Not found");
      expect(notFound.toUserMessage()).toBe(
        "API error (404): Not found. Please verify that the organization, project, or resource ID is correct and that you have access to it.",
      );
    });
  });

  describe("createApiError factory", () => {
    it("should create ApiAuthenticationError for 401", () => {
      const error = createApiError("Unauthorized", 401, "Invalid token");
      expect(error).toBeInstanceOf(ApiAuthenticationError);
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(401);
      expect(error.message).toBe("Unauthorized");
      expect(error.detail).toBe("Invalid token");
    });

    it("should create ApiPermissionError for 403", () => {
      const error = createApiError("Forbidden", 403, "No access");
      expect(error).toBeInstanceOf(ApiPermissionError);
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(403);
    });

    it("should create ApiNotFoundError for 404", () => {
      const error = createApiError("Not Found", 404, "Project not found");
      expect(error).toBeInstanceOf(ApiNotFoundError);
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(404);
    });

    it("should create ApiValidationError for 400", () => {
      const error = createApiError("Bad Request", 400, "Invalid data");
      expect(error).toBeInstanceOf(ApiValidationError);
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(400);
    });

    it("should create ApiValidationError for 422", () => {
      const error = createApiError(
        "Unprocessable Entity",
        422,
        "Validation failed",
      );
      expect(error).toBeInstanceOf(ApiValidationError);
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(422);
    });

    it("should create ApiRateLimitError for 429", () => {
      const error = createApiError("Too Many Requests", 429, "Rate limited", {
        retry_after: 60,
      });
      expect(error).toBeInstanceOf(ApiRateLimitError);
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(429);
      expect((error as ApiRateLimitError).retryAfter).toBe(60);
    });

    it("should create generic ApiClientError for other 4xx", () => {
      const error = createApiError("Conflict", 409);
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).not.toBeInstanceOf(ApiPermissionError);
      expect(error).not.toBeInstanceOf(ApiNotFoundError);
      expect(error.status).toBe(409);
    });

    it("should create ApiServerError for 500", () => {
      const error = createApiError("Internal Server Error", 500);
      expect(error).toBeInstanceOf(ApiServerError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(ApiClientError);
      expect(error.status).toBe(500);
      expect((error as ApiServerError).isInternalError()).toBe(true);
    });

    it("should create ApiServerError for gateway errors", () => {
      const error502 = createApiError("Bad Gateway", 502);
      const error503 = createApiError("Service Unavailable", 503);
      const error504 = createApiError("Gateway Timeout", 504);

      expect(error502).toBeInstanceOf(ApiServerError);
      expect((error502 as ApiServerError).isGatewayError()).toBe(true);

      expect(error503).toBeInstanceOf(ApiServerError);
      expect((error503 as ApiServerError).isGatewayError()).toBe(true);

      expect(error504).toBeInstanceOf(ApiServerError);
      expect((error504 as ApiServerError).isGatewayError()).toBe(true);
    });

    it("should create generic ApiError for unusual status codes", () => {
      const error = createApiError("Redirect", 301);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(ApiClientError);
      expect(error).not.toBeInstanceOf(ApiServerError);
    });

    it("should improve multi-project error messages", () => {
      const error1 = createApiError(
        "You do not have the multi project stream feature enabled",
        403,
      );
      expect(error1).toBeInstanceOf(ApiPermissionError);
      expect(error1.message).toBe(
        "You do not have access to query across multiple projects. Please select a project for your query.",
      );
      expect((error1 as ApiPermissionError).isMultiProjectAccessError()).toBe(
        true,
      );

      const error2 = createApiError(
        "You cannot view events from multiple projects",
        403,
      );
      expect(error2.message).toBe(
        "You do not have access to query across multiple projects. Please select a project for your query.",
      );
      expect((error2 as ApiPermissionError).isMultiProjectAccessError()).toBe(
        true,
      );
    });

    it("should extract retry-after from response body", () => {
      const error1 = createApiError("Rate limited", 429, undefined, {
        retry_after: 120,
      });
      expect((error1 as ApiRateLimitError).retryAfter).toBe(120);

      const error2 = createApiError("Rate limited", 429, undefined, {
        retryAfter: 60,
      });
      expect((error2 as ApiRateLimitError).retryAfter).toBe(60);
    });

    it("should extract validation errors from response body", () => {
      const validationErrors = {
        email: ["Invalid email format"],
        password: ["Too short", "Must contain numbers"],
      };
      const error = createApiError("Validation failed", 400, undefined, {
        errors: validationErrors,
      });
      expect((error as ApiValidationError).validationErrors).toEqual(
        validationErrors,
      );
    });
  });

  describe("Error class inheritance", () => {
    it("should maintain proper prototype chain", () => {
      const permissionError = new ApiPermissionError("No access");
      const notFoundError = new ApiNotFoundError("Not found");
      const serverError = new ApiServerError("Server error", 500);

      // Check prototype chain for permission error
      expect(permissionError instanceof ApiPermissionError).toBe(true);
      expect(permissionError instanceof ApiClientError).toBe(true);
      expect(permissionError instanceof ApiError).toBe(true);
      expect(permissionError instanceof Error).toBe(true);

      // Check prototype chain for not found error
      expect(notFoundError instanceof ApiNotFoundError).toBe(true);
      expect(notFoundError instanceof ApiClientError).toBe(true);
      expect(notFoundError instanceof ApiError).toBe(true);
      expect(notFoundError instanceof Error).toBe(true);

      // Check prototype chain for server error
      expect(serverError instanceof ApiServerError).toBe(true);
      expect(serverError instanceof ApiError).toBe(true);
      expect(serverError instanceof Error).toBe(true);
      expect(serverError instanceof ApiClientError).toBe(false);
    });
  });

  describe("Helper methods", () => {
    describe("ApiClientError", () => {
      it("should correctly identify error types", () => {
        const clientError = new ApiClientError("Error", 403);
        expect(clientError.isPermissionError()).toBe(true);
        expect(clientError.isNotFoundError()).toBe(false);
        expect(clientError.isValidationError()).toBe(false);
        expect(clientError.isAuthenticationError()).toBe(false);
        expect(clientError.isRateLimitError()).toBe(false);
      });

      it("should identify validation errors", () => {
        const error400 = new ApiClientError("Bad Request", 400);
        const error422 = new ApiClientError("Unprocessable", 422);

        expect(error400.isValidationError()).toBe(true);
        expect(error422.isValidationError()).toBe(true);
      });
    });

    describe("ApiPermissionError", () => {
      it("should detect multi-project access errors", () => {
        const error1 = new ApiPermissionError(
          "You do not have access to query across multiple projects",
        );
        expect(error1.isMultiProjectAccessError()).toBe(true);

        const error2 = new ApiPermissionError("Regular permission denied");
        expect(error2.isMultiProjectAccessError()).toBe(false);
      });
    });

    describe("ApiServerError", () => {
      it("should identify gateway errors", () => {
        const error502 = new ApiServerError("Bad Gateway", 502);
        const error503 = new ApiServerError("Service Unavailable", 503);
        const error504 = new ApiServerError("Gateway Timeout", 504);
        const error500 = new ApiServerError("Internal Error", 500);

        expect(error502.isGatewayError()).toBe(true);
        expect(error503.isGatewayError()).toBe(true);
        expect(error504.isGatewayError()).toBe(true);
        expect(error500.isGatewayError()).toBe(false);
      });

      it("should identify internal server errors", () => {
        const error500 = new ApiServerError("Internal Error", 500);
        const error502 = new ApiServerError("Bad Gateway", 502);

        expect(error500.isInternalError()).toBe(true);
        expect(error502.isInternalError()).toBe(false);
      });
    });
  });

  describe("Error properties", () => {
    it("should preserve all properties", () => {
      const responseBody = { detail: "Error detail", extra: "data" };
      const error = createApiError(
        "Test error",
        403,
        "Detail text",
        responseBody,
      );

      expect(error.message).toBe("Test error");
      expect(error.status).toBe(403);
      expect(error.detail).toBe("Detail text");
      expect(error.responseBody).toEqual(responseBody);
      expect(error.name).toBe("ApiPermissionError");
    });

    it("should set correct error names", () => {
      expect(new ApiError("", 0).name).toBe("ApiError");
      expect(new ApiClientError("", 400).name).toBe("ApiClientError");
      expect(new ApiServerError("", 500).name).toBe("ApiServerError");
      expect(new ApiPermissionError("").name).toBe("ApiPermissionError");
      expect(new ApiNotFoundError("").name).toBe("ApiNotFoundError");
      expect(new ApiValidationError("", 400).name).toBe("ApiValidationError");
      expect(new ApiAuthenticationError("").name).toBe(
        "ApiAuthenticationError",
      );
      expect(new ApiRateLimitError("").name).toBe("ApiRateLimitError");
    });
  });
});
