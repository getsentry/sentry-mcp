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
      expect(isTerminalStatus("COMPLETED")).toBe(true);
      expect(isTerminalStatus("FAILED")).toBe(true);
      expect(isTerminalStatus("ERROR")).toBe(true);
      expect(isTerminalStatus("CANCELLED")).toBe(true);
      expect(isTerminalStatus("NEED_MORE_INFORMATION")).toBe(true);
      expect(isTerminalStatus("WAITING_FOR_USER_RESPONSE")).toBe(true);
    });

    it("returns false for non-terminal statuses", () => {
      expect(isTerminalStatus("PROCESSING")).toBe(false);
      expect(isTerminalStatus("IN_PROGRESS")).toBe(false);
      expect(isTerminalStatus("PENDING")).toBe(false);
    });
  });

  describe("isHumanInterventionStatus", () => {
    it("returns true for human intervention statuses", () => {
      expect(isHumanInterventionStatus("NEED_MORE_INFORMATION")).toBe(true);
      expect(isHumanInterventionStatus("WAITING_FOR_USER_RESPONSE")).toBe(true);
    });

    it("returns false for other statuses", () => {
      expect(isHumanInterventionStatus("COMPLETED")).toBe(false);
      expect(isHumanInterventionStatus("PROCESSING")).toBe(false);
      expect(isHumanInterventionStatus("FAILED")).toBe(false);
    });
  });

  describe("getStatusDisplayName", () => {
    it("returns friendly names for known statuses", () => {
      expect(getStatusDisplayName("COMPLETED")).toBe("Complete");
      expect(getStatusDisplayName("FAILED")).toBe("Failed");
      expect(getStatusDisplayName("ERROR")).toBe("Failed");
      expect(getStatusDisplayName("CANCELLED")).toBe("Cancelled");
      expect(getStatusDisplayName("NEED_MORE_INFORMATION")).toBe(
        "Needs More Information",
      );
      expect(getStatusDisplayName("WAITING_FOR_USER_RESPONSE")).toBe(
        "Waiting for Response",
      );
      expect(getStatusDisplayName("PROCESSING")).toBe("Processing");
      expect(getStatusDisplayName("IN_PROGRESS")).toBe("In Progress");
    });

    it("returns status as-is for unknown statuses", () => {
      expect(getStatusDisplayName("UNKNOWN_STATUS")).toBe("UNKNOWN_STATUS");
    });
  });

  describe("getHumanInterventionGuidance", () => {
    it("returns guidance for NEED_MORE_INFORMATION", () => {
      const guidance = getHumanInterventionGuidance("NEED_MORE_INFORMATION");
      expect(guidance).toContain("Seer needs additional information");
    });

    it("returns guidance for WAITING_FOR_USER_RESPONSE", () => {
      const guidance = getHumanInterventionGuidance(
        "WAITING_FOR_USER_RESPONSE",
      );
      expect(guidance).toContain("Seer is waiting for your response");
    });

    it("returns empty string for other statuses", () => {
      expect(getHumanInterventionGuidance("COMPLETED")).toBe("");
      expect(getHumanInterventionGuidance("PROCESSING")).toBe("");
    });
  });

  describe("getOutputForAutofixStep", () => {
    it("keeps the heading when a completed root cause step has no generated output", () => {
      const output = getOutputForAutofixStep({
        type: "root_cause_analysis",
        key: "root_cause_analysis",
        index: 0,
        status: "COMPLETED",
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
        status: "COMPLETED",
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
        status: "COMPLETED",
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
