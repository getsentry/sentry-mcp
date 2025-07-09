import { describe, it, expect } from "vitest";
import {
  isTerminalStatus,
  isHumanInterventionStatus,
  getStatusDisplayName,
  getHumanInterventionGuidance,
} from "./seer-utils.js";

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
});
