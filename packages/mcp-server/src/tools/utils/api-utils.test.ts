import { describe, it, expect } from "vitest";
import { ApiError } from "../../api-client";
import { UserInputError } from "../../errors";
import { handleApiError, withApiErrorHandling } from "./api-utils";

describe("handleApiError", () => {
  it("converts 404 errors for issues to UserInputError", () => {
    const error = new ApiError("Not Found", 404);

    expect(() =>
      handleApiError(error, { operation: "getIssue", resourceId: "PROJ-123" }),
    ).toThrow(UserInputError);

    expect(() =>
      handleApiError(error, { operation: "getIssue", resourceId: "PROJ-123" }),
    ).toThrow(
      "Issue 'PROJ-123' not found. Please verify the issue ID is correct.",
    );
  });

  it("converts 404 errors for other resources appropriately", () => {
    const error = new ApiError("Not Found", 404);

    expect(() =>
      handleApiError(error, {
        operation: "getOrganization",
        resourceId: "my-org",
      }),
    ).toThrow(
      "Organization 'my-org' not found. Please verify the organization slug is correct.",
    );

    expect(() =>
      handleApiError(error, {
        operation: "getProject",
        resourceId: "my-project",
      }),
    ).toThrow(
      "Project 'my-project' not found. Please verify the project slug is correct.",
    );
  });

  it("converts 400 errors to UserInputError", () => {
    const error = new ApiError("Invalid parameters", 400);

    expect(() =>
      handleApiError(error, { operation: "getIssue", resourceId: "PROJ-123" }),
    ).toThrow(UserInputError);

    expect(() =>
      handleApiError(error, { operation: "getIssue", resourceId: "PROJ-123" }),
    ).toThrow("Invalid request: Invalid parameters");
  });

  it("converts 403 errors to UserInputError with access message", () => {
    const error = new ApiError("Forbidden", 403);

    expect(() =>
      handleApiError(error, { operation: "getIssue", resourceId: "PROJ-123" }),
    ).toThrow(
      "Access denied: Forbidden. Please verify you have access to this resource.",
    );
  });

  it("re-throws non-API errors unchanged", () => {
    const error = new Error("Network error");

    expect(() =>
      handleApiError(error, { operation: "getIssue", resourceId: "PROJ-123" }),
    ).toThrow(error);
  });
});

describe("withApiErrorHandling", () => {
  it("returns successful results unchanged", async () => {
    const result = await withApiErrorHandling(
      async () => ({ id: "123", title: "Test Issue" }),
      { operation: "getIssue", resourceId: "PROJ-123" },
    );

    expect(result).toEqual({ id: "123", title: "Test Issue" });
  });

  it("handles errors through handleApiError", async () => {
    const error = new ApiError("Not Found", 404);

    await expect(
      withApiErrorHandling(
        async () => {
          throw error;
        },
        { operation: "getIssue", resourceId: "PROJ-123" },
      ),
    ).rejects.toThrow(
      "Issue 'PROJ-123' not found. Please verify the issue ID is correct.",
    );
  });
});
