import { describe, it, expect } from "vitest";
import { ApiNotFoundError, createApiError } from "../../api-client";
import { UserInputError } from "../../errors";
import { handleApiError } from "./api";

describe("handleApiError", () => {
  it("converts 404 errors with params to list all parameters", () => {
    const error = new ApiNotFoundError("Not Found");

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
      "Resource not found (404): Not Found\nPlease verify these parameters are correct:\n  - organizationSlug: 'my-org'\n  - issueId: 'PROJ-123'",
    );
  });

  it("converts 404 errors with multiple params including nullish values", () => {
    const error = new ApiNotFoundError("Not Found");

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
      "Resource not found (404): Not Found\nPlease verify these parameters are correct:\n  - organizationSlug: 'my-org'\n  - projectSlug: 'my-project'\n  - limit: '0'",
    );
  });

  it("converts 404 errors with no params to generic message", () => {
    const error = new ApiNotFoundError("Not Found");

    expect(() => handleApiError(error, {})).toThrow(
      "API error (404): Not Found",
    );
  });

  it("converts 400 errors to UserInputError", () => {
    const error = createApiError("Invalid parameters", 400);

    expect(() => handleApiError(error)).toThrow(UserInputError);

    expect(() => handleApiError(error)).toThrow(
      "API error (400): Invalid parameters",
    );
  });

  it("converts 403 errors to UserInputError with access message", () => {
    const error = createApiError("Forbidden", 403);

    expect(() => handleApiError(error)).toThrow("API error (403): Forbidden");
  });

  it("re-throws non-API errors unchanged", () => {
    const error = new Error("Network error");

    expect(() => handleApiError(error)).toThrow(error);
  });
});
