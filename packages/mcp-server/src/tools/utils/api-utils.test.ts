import { describe, it, expect } from "vitest";
import { ApiError } from "../../api-client";
import { UserInputError } from "../../errors";
import { handleApiError, withApiErrorHandling } from "./api-utils";

describe("handleApiError", () => {
  it("converts 404 errors with params to list all parameters", () => {
    const error = new ApiError("Not Found", 404);

    expect(() =>
      handleApiError(error, {
        organizationSlug: "my-org",
        issueId: "PROJ-123",
      }),
    ).toThrow(UserInputError);

    expect(() =>
      handleApiError(error, {
        organizationSlug: "my-org",
        issueId: "PROJ-123",
      }),
    ).toThrow(
      "Resource not found. Please verify these parameters are correct:\n  - organizationSlug: 'my-org'\n  - issueId: 'PROJ-123'",
    );
  });

  it("converts 404 errors with multiple params including nullish values", () => {
    const error = new ApiError("Not Found", 404);

    expect(() =>
      handleApiError(error, {
        organizationSlug: "my-org",
        projectSlug: "my-project",
        query: undefined,
        sortBy: null,
        limit: 0,
        emptyString: "",
      }),
    ).toThrow(
      "Resource not found. Please verify these parameters are correct:\n  - organizationSlug: 'my-org'\n  - projectSlug: 'my-project'\n  - limit: '0'",
    );
  });

  it("converts 404 errors with no params to generic message", () => {
    const error = new ApiError("Not Found", 404);

    expect(() => handleApiError(error, {})).toThrow(
      "Resource not found (404). Please verify that all provided identifiers are correct and you have access to the requested resources.",
    );
  });

  it("converts 400 errors to UserInputError", () => {
    const error = new ApiError("Invalid parameters", 400);

    expect(() => handleApiError(error)).toThrow(UserInputError);

    expect(() => handleApiError(error)).toThrow(
      "Invalid request: Invalid parameters",
    );
  });

  it("converts 403 errors to UserInputError with access message", () => {
    const error = new ApiError("Forbidden", 403);

    expect(() => handleApiError(error)).toThrow(
      "Access denied: Forbidden. Please verify you have access to this resource.",
    );
  });

  it("re-throws non-API errors unchanged", () => {
    const error = new Error("Network error");

    expect(() => handleApiError(error)).toThrow(error);
  });
});

describe("withApiErrorHandling", () => {
  it("returns successful results unchanged", async () => {
    const result = await withApiErrorHandling(
      async () => ({ id: "123", title: "Test Issue" }),
      { issueId: "PROJ-123" },
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
        {
          organizationSlug: "my-org",
          issueId: "PROJ-123",
        },
      ),
    ).rejects.toThrow(
      "Resource not found. Please verify these parameters are correct:\n  - organizationSlug: 'my-org'\n  - issueId: 'PROJ-123'",
    );
  });
});
