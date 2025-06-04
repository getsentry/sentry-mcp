import { describe, expect, it } from "vitest";
import { UserInputError } from "./errors";

describe("UserInputError", () => {
  it("should create a UserInputError with the correct message and name", () => {
    const message = "Invalid input provided";
    const error = new UserInputError(message);

    expect(error.message).toBe(message);
    expect(error.name).toBe("UserInputError");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof UserInputError).toBe(true);
  });

  it("should be distinguishable from regular Error", () => {
    const userInputError = new UserInputError("User input error");
    const regularError = new Error("Regular error");

    expect(userInputError instanceof UserInputError).toBe(true);
    expect(regularError instanceof UserInputError).toBe(false);
  });
});
