import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentUser } from "./whoami";
import type { SentryApiService } from "../../../api-client";

describe("whoami agent tool", () => {
  let mockApiService: SentryApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiService = {
      getAuthenticatedUser: vi.fn(),
    } as unknown as SentryApiService;
  });

  describe("getCurrentUser", () => {
    it("should return current user information", async () => {
      const mockUser = {
        id: "123",
        name: "John Doe",
        email: "john.doe@example.com",
      };

      (mockApiService.getAuthenticatedUser as any).mockResolvedValue(mockUser);

      const result = await getCurrentUser(mockApiService);

      expect(result).toEqual({
        id: "123",
        name: "John Doe",
        email: "john.doe@example.com",
      });

      expect(mockApiService.getAuthenticatedUser).toHaveBeenCalledOnce();
    });

    it("should handle API errors gracefully", async () => {
      (mockApiService.getAuthenticatedUser as any).mockRejectedValue(
        new Error("Unauthorized"),
      );

      await expect(getCurrentUser(mockApiService)).rejects.toThrow(
        "Unauthorized",
      );
    });
  });
});
