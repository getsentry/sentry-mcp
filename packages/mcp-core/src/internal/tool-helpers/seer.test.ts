import { describe, it, expect } from "vitest";
import {
  isTerminalStatus,
  isHumanInterventionStatus,
  getStatusDisplayName,
  getHumanInterventionGuidance,
  getOutputForAutofixStep,
} from "./seer";

describe("seer-utils", () => {
  describe("isTerminalStatus", () => {
    it("returns true for terminal statuses", () => {
      expect(isTerminalStatus("completed")).toBe(true);
      expect(isTerminalStatus("error")).toBe(true);
      expect(isTerminalStatus("awaiting_user_input")).toBe(true);
    });

    it("returns false for non-terminal statuses", () => {
      expect(isTerminalStatus("processing")).toBe(false);
    });
  });

  describe("isHumanInterventionStatus", () => {
    it("returns true for human intervention statuses", () => {
      expect(isHumanInterventionStatus("awaiting_user_input")).toBe(true);
    });

    it("returns false for other statuses", () => {
      expect(isHumanInterventionStatus("completed")).toBe(false);
      expect(isHumanInterventionStatus("processing")).toBe(false);
      expect(isHumanInterventionStatus("error")).toBe(false);
    });
  });

  describe("getStatusDisplayName", () => {
    it("returns friendly names for known statuses", () => {
      expect(getStatusDisplayName("completed")).toBe("Complete");
      expect(getStatusDisplayName("error")).toBe("Failed");
      expect(getStatusDisplayName("awaiting_user_input")).toBe(
        "Waiting for Response",
      );
      expect(getStatusDisplayName("processing")).toBe("Processing");
    });

    it("returns status as-is for unknown statuses", () => {
      expect(getStatusDisplayName("unknown_status")).toBe("unknown_status");
    });
  });

  describe("getHumanInterventionGuidance", () => {
    it("returns guidance for awaiting_user_input", () => {
      const guidance = getHumanInterventionGuidance("awaiting_user_input");
      expect(guidance).toContain("Seer is waiting for your response");
    });

    it("returns empty string for other statuses", () => {
      expect(getHumanInterventionGuidance("completed")).toBe("");
      expect(getHumanInterventionGuidance("processing")).toBe("");
    });
  });

  describe("getOutputForAutofixStep", () => {
    it("keeps the heading when a completed root cause step has no generated output", () => {
      const output = getOutputForAutofixStep({
        type: "root_cause_analysis",
        key: "root_cause_analysis",
        index: 0,
        status: "completed",
        title: "Root Cause Analysis",
        output_stream: null,
        progress: [],
        causes: [],
      });

      expect(output).toBe("## Root Cause Analysis\n\n");
    });

    it("keeps the heading when a completed solution step has no generated output", () => {
      const output = getOutputForAutofixStep({
        type: "solution",
        key: "solution",
        index: 0,
        status: "completed",
        title: "Proposed Solution",
        output_stream: null,
        progress: [],
        description: "",
        solution: [],
      });

      expect(output).toBe("## Proposed Solution\n\n");
    });

    it("does not stringify null solution descriptions", () => {
      const output = getOutputForAutofixStep({
        type: "solution",
        key: "solution",
        index: 0,
        status: "completed",
        title: "Proposed Solution",
        output_stream: null,
        progress: [],
        description: null,
        solution: [
          {
            code_snippet_and_analysis:
              "Use the canonical issue identifier before retrying.",
            is_active: true,
            is_most_important_event: true,
            relevant_code_file: null,
            timeline_item_type: "internal_code",
            title: "Normalize the issue identifier",
          },
        ],
      });

      expect(output).toContain("Normalize the issue identifier");
      expect(output).not.toContain("null");
      expect(output).not.toContain("undefined");
    });
  });
});
