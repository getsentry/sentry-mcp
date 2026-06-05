import { describe, expect, it } from "vitest";
import { getAvailableToolDescriptions } from "./mcpClient";

describe("getAvailableToolDescriptions", () => {
  it("uses stable tool definitions for prediction prompts", async () => {
    const descriptions = await getAvailableToolDescriptions();
    const toolNames = descriptions.map((description) =>
      description.slice(0, description.indexOf(" - ")),
    );

    expect(toolNames).toContain("find_teams");
    expect(toolNames).toContain("create_project");
    expect(toolNames).toContain("find_releases");
  });
});
