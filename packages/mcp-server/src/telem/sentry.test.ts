import { describe, it, expect } from "vitest";
import {
  sentryBeforeSend,
  addScrubPattern,
  getScrubPatterns,
  EventSerializationError,
} from "./sentry";
import type * as Sentry from "@sentry/node";

describe("sentry", () => {
  describe("OpenAI API key scrubbing", () => {
    it("should scrub OpenAI API keys from message", () => {
      const event: Sentry.Event = {
        message:
          "Error with key: sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.message).toBe("Error with key: [REDACTED_OPENAI_KEY]");
    });

    it("should scrub multiple OpenAI keys", () => {
      const event: Sentry.Event = {
        message:
          "Keys: sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234 and sk-xyz123def456ghi789jkl012mno345pqr678stu901vwx234",
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.message).toBe(
        "Keys: [REDACTED_OPENAI_KEY] and [REDACTED_OPENAI_KEY]",
      );
    });

    it("should not scrub partial matches", () => {
      const event: Sentry.Event = {
        message:
          "Not a key: sk-abc or task-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.message).toBe(event.message);
    });
  });

  describe("Bearer token scrubbing", () => {
    it("should scrub Bearer tokens", () => {
      const event: Sentry.Event = {
        message:
          "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.message).toBe("Authorization: Bearer [REDACTED_TOKEN]");
    });
  });

  describe("Sentry token scrubbing", () => {
    it("should scrub Sentry access tokens", () => {
      const event: Sentry.Event = {
        message:
          "Using token: sntrys_eyJpYXQiOjE2OTQwMzMxNTMuNzk0NjI4LCJ1cmwiOiJodHRwczovL3NlbnRyeS5pbyIsInJlZ2lvbl91cmwiOiJodHRwczovL3VzLnNlbnRyeS5pbyIsIm9yZyI6InNlbnRyeSJ9_abcdef123456",
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.message).toBe("Using token: [REDACTED_SENTRY_TOKEN]");
    });
  });

  describe("Deep object scrubbing", () => {
    it("should scrub sensitive data from nested objects", () => {
      const event: Sentry.Event = {
        extra: {
          config: {
            apiKey: "sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
            headers: {
              Authorization: "Bearer token123",
            },
          },
        },
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.extra).toEqual({
        config: {
          apiKey: "[REDACTED_OPENAI_KEY]",
          headers: {
            Authorization: "Bearer [REDACTED_TOKEN]",
          },
        },
      });
    });

    it("should remove breadcrumbs entirely", () => {
      const event: Sentry.Event = {
        message: "Test event",
        breadcrumbs: [
          {
            message:
              "API call with sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
            data: {
              tokens: ["sntrys_token1", "sntrys_token2"],
            },
          },
        ],
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.breadcrumbs).toBeUndefined();
      expect(result?.message).toBe("Test event");
    });
  });

  describe("Exception scrubbing", () => {
    it("should scrub from exception values", () => {
      const event: Sentry.Event = {
        exception: {
          values: [
            {
              type: "Error",
              value:
                "Failed to authenticate with sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
            },
          ],
        },
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.exception?.values?.[0].value).toBe(
        "Failed to authenticate with [REDACTED_OPENAI_KEY]",
      );
    });
  });

  describe("No sensitive data", () => {
    it("should return event unchanged when no sensitive data", () => {
      const event: Sentry.Event = {
        message: "Normal error message",
        extra: {
          foo: "bar",
        },
      };

      const result = sentryBeforeSend(event, {});
      expect(result).toEqual(event);
    });
  });

  describe("Regex state handling", () => {
    it("should handle multiple calls without regex state corruption", () => {
      // This tests the bug where global regex patterns maintain lastIndex between calls
      const event1: Sentry.Event = {
        message:
          "First error with sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
      };

      const event2: Sentry.Event = {
        message:
          "Second error with sk-xyz123def456ghi789jkl012mno345pqr678stu901vwx234",
      };

      // Call sentryBeforeSend multiple times
      const result1 = sentryBeforeSend(event1, {});
      const result2 = sentryBeforeSend(event2, {});

      // Both should be properly scrubbed
      expect(result1?.message).toBe("First error with [REDACTED_OPENAI_KEY]");
      expect(result2?.message).toBe("Second error with [REDACTED_OPENAI_KEY]");

      // Test multiple replacements in the same string
      const event3: Sentry.Event = {
        message:
          "Multiple keys: sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234 and sk-xyz123def456ghi789jkl012mno345pqr678stu901vwx234",
      };

      const result3 = sentryBeforeSend(event3, {});
      expect(result3?.message).toBe(
        "Multiple keys: [REDACTED_OPENAI_KEY] and [REDACTED_OPENAI_KEY]",
      );
    });
  });

  describe("Error handling", () => {
    it("should throw EventSerializationError for circular references", () => {
      const circular: any = { message: "Error occurred" };
      circular.self = circular; // Create circular reference

      const event: Sentry.Event = circular;

      // Should throw EventSerializationError
      expect(() => sentryBeforeSend(event, {})).toThrow(
        EventSerializationError,
      );
      expect(() => sentryBeforeSend(event, {})).toThrow(
        "[Sentry Scrubbing] Cannot serialize event for sensitive data check",
      );
    });

    it("should throw EventSerializationError for non-serializable values", () => {
      const event: any = {
        message: "Error with function",
        extra: {
          fn: () => console.log("test"),
          bigint: BigInt(123),
        },
      };

      // Should throw EventSerializationError
      expect(() => sentryBeforeSend(event, {})).toThrow(
        EventSerializationError,
      );
      expect(() => sentryBeforeSend(event, {})).toThrow(
        "[Sentry Scrubbing] Cannot serialize event for sensitive data check",
      );
    });
  });

  describe("Custom patterns", () => {
    it("should support adding custom patterns", () => {
      const initialPatterns = getScrubPatterns().length;

      addScrubPattern(
        /custom_secret_\w+/,
        "[REDACTED_CUSTOM]",
        "Custom secret",
      );

      expect(getScrubPatterns().length).toBe(initialPatterns + 1);

      // The new pattern is now available in sentryBeforeSend
      const event: Sentry.Event = {
        message: "Secret: custom_secret_12345",
      };

      const result = sentryBeforeSend(event, {});
      expect(result?.message).toBe("Secret: [REDACTED_CUSTOM]");
    });
  });
});
