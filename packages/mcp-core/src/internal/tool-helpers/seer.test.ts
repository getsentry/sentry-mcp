import { describe, it, expect } from "vitest";
import {
  isTerminalStatus,
  isHumanInterventionStatus,
  getStatusDisplayName,
  getHumanInterventionGuidance,
  getOrderedAutofixSections,
  getOutputForAutofixSection,
  findCompletedSection,
} from "./seer";

describe("seer-utils", () => {
  describe("isTerminalStatus", () => {
    it("treats `processing` as the only non-terminal status", () => {
      expect(isTerminalStatus("processing")).toBe(false);
      expect(isTerminalStatus("completed")).toBe(true);
      expect(isTerminalStatus("error")).toBe(true);
      expect(isTerminalStatus("awaiting_user_input")).toBe(true);
    });
  });

  describe("isHumanInterventionStatus", () => {
    it("flags awaiting_user_input only", () => {
      expect(isHumanInterventionStatus("awaiting_user_input")).toBe(true);
      expect(isHumanInterventionStatus("completed")).toBe(false);
      expect(isHumanInterventionStatus("processing")).toBe(false);
      expect(isHumanInterventionStatus("error")).toBe(false);
    });
  });

  describe("getStatusDisplayName", () => {
    it("renders friendly names for explorer statuses", () => {
      expect(getStatusDisplayName("completed")).toBe("Complete");
      expect(getStatusDisplayName("error")).toBe("Failed");
      expect(getStatusDisplayName("awaiting_user_input")).toBe(
        "Waiting for Response",
      );
      expect(getStatusDisplayName("processing")).toBe("Processing");
    });

    it("returns unknown statuses as-is", () => {
      expect(getStatusDisplayName("unknown_status")).toBe("unknown_status");
    });
  });

  describe("getHumanInterventionGuidance", () => {
    it("returns guidance for awaiting_user_input", () => {
      expect(getHumanInterventionGuidance("awaiting_user_input")).toContain(
        "Seer is waiting for your response",
      );
    });

    it("returns empty string for other statuses", () => {
      expect(getHumanInterventionGuidance("completed")).toBe("");
      expect(getHumanInterventionGuidance("processing")).toBe("");
    });
  });

  describe("getOrderedAutofixSections", () => {
    it("splits blocks by metadata.step and attaches artifacts", () => {
      const sections = getOrderedAutofixSections({
        run_id: 1,
        status: "completed",
        blocks: [
          {
            id: "b1",
            message: {
              role: "assistant",
              content: "looking",
              metadata: { step: "root_cause" },
            },
            artifacts: [
              {
                key: "root_cause",
                reason: "found",
                data: { one_line_description: "Null deref" },
              },
            ],
          },
          {
            id: "b2",
            message: {
              role: "assistant",
              content: "plan",
              metadata: { step: "solution" },
            },
            artifacts: [
              {
                key: "solution",
                reason: "drafted",
                data: { one_line_summary: "Add null guard", steps: [] },
              },
            ],
          },
        ],
      });

      expect(sections.map((s) => s.step)).toEqual(["root_cause", "solution"]);
      expect(sections.every((s) => s.status === "completed")).toBe(true);
    });

    it("synthesizes a pull_request section from repo_pr_states", () => {
      const sections = getOrderedAutofixSections({
        run_id: 1,
        status: "completed",
        blocks: [],
        repo_pr_states: {
          "owner/repo": {
            repo_name: "owner/repo",
            pr_url: "https://github.com/owner/repo/pull/1",
            pr_number: 1,
            pr_creation_status: "completed",
            title: "Fix null deref",
          },
        },
      });

      expect(sections.find((s) => s.step === "pull_request")?.status).toBe(
        "completed",
      );
    });
  });

  describe("getOutputForAutofixSection", () => {
    it("renders the root cause artifact with provenance tags", () => {
      const section = {
        step: "root_cause",
        status: "completed" as const,
        blocks: [],
        artifacts: [
          {
            key: "root_cause",
            reason: "Identified",
            data: {
              one_line_description: "Mismatched IDs in batched request.",
              five_whys: ["Wrong ID.", "Batched call."],
              reproduction_steps: ["Open bottle detail page."],
            },
          },
        ],
        mergedFilePatches: [],
      };

      const output = getOutputForAutofixSection(section, { runId: 42 });
      expect(output).toContain('<seer_analysis run_id="42" step="root_cause">');
      expect(output).toContain("Mismatched IDs in batched request.");
      expect(output).toContain("- Wrong ID.");
      expect(output).toContain("- Open bottle detail page.");
    });

    it("renders the solution artifact with steps", () => {
      const section = {
        step: "solution",
        status: "completed" as const,
        blocks: [],
        artifacts: [
          {
            key: "solution",
            reason: "Plan",
            data: {
              one_line_summary: "Add a null guard.",
              steps: [
                { title: "Step A", description: "Do A." },
                { title: "Step B", description: "Do B." },
              ],
            },
          },
        ],
        mergedFilePatches: [],
      };

      const output = getOutputForAutofixSection(section);
      expect(output).toContain("Add a null guard.");
      expect(output).toContain("**Step A**");
      expect(output).toContain("Do A.");
      expect(output).toContain("**Step B**");
    });

    it("shows a placeholder when a section is still processing", () => {
      const section = {
        step: "root_cause",
        status: "processing" as const,
        blocks: [],
        artifacts: [],
        mergedFilePatches: [],
      };

      expect(getOutputForAutofixSection(section)).toContain(
        "Sentry is still working on this step",
      );
    });
  });

  describe("findCompletedSection", () => {
    it("finds the matching completed section", () => {
      const sections = [
        {
          step: "root_cause" as const,
          status: "completed" as const,
          blocks: [],
          artifacts: [],
          mergedFilePatches: [],
        },
        {
          step: "solution" as const,
          status: "processing" as const,
          blocks: [],
          artifacts: [],
          mergedFilePatches: [],
        },
      ];

      expect(findCompletedSection(sections, "root_cause")?.step).toBe(
        "root_cause",
      );
      expect(findCompletedSection(sections, "solution")).toBeUndefined();
    });
  });
});
