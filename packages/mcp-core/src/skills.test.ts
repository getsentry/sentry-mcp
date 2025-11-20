import { describe, it, expect } from "vitest";
import {
  SKILLS,
  DEFAULT_SKILLS,
  isValidSkill,
  parseSkills,
  hasRequiredSkills,
  type Skill,
} from "./skills";

describe("skills module", () => {
  describe("SKILLS registry", () => {
    it("has all expected skills", () => {
      expect(SKILLS.inspect).toBeDefined();
      expect(SKILLS.triage).toBeDefined();
      expect(SKILLS["project-management"]).toBeDefined();
      expect(SKILLS.seer).toBeDefined();
      expect(SKILLS.docs).toBeDefined();
    });

    it("includes metadata for each skill", () => {
      for (const skill of Object.values(SKILLS)) {
        expect(skill.id).toBeTruthy();
        expect(skill.name).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(typeof skill.defaultEnabled).toBe("boolean");
        expect(typeof skill.order).toBe("number");
      }
    });
  });

  describe("DEFAULT_SKILLS", () => {
    it("includes only default-enabled skills", () => {
      expect(DEFAULT_SKILLS).toContain("inspect");
      expect(DEFAULT_SKILLS).toContain("seer");
      expect(DEFAULT_SKILLS).not.toContain("docs");
      expect(DEFAULT_SKILLS).not.toContain("triage");
      expect(DEFAULT_SKILLS).not.toContain("project-management");
    });

    it("has exactly 2 default skills", () => {
      expect(DEFAULT_SKILLS.length).toBe(2);
    });
  });

  describe("isValidSkill", () => {
    it("returns true for valid skills", () => {
      expect(isValidSkill("inspect")).toBe(true);
      expect(isValidSkill("triage")).toBe(true);
      expect(isValidSkill("project-management")).toBe(true);
      expect(isValidSkill("seer")).toBe(true);
      expect(isValidSkill("docs")).toBe(true);
    });

    it("returns false for invalid skills", () => {
      expect(isValidSkill("invalid")).toBe(false);
      expect(isValidSkill("")).toBe(false);
      expect(isValidSkill("INSPECT")).toBe(false);
    });
  });

  describe("parseSkills", () => {
    it("parses comma-separated string", () => {
      const { valid, invalid } = parseSkills("inspect,triage,docs");
      expect(valid.size).toBe(3);
      expect(valid.has("inspect")).toBe(true);
      expect(valid.has("triage")).toBe(true);
      expect(valid.has("docs")).toBe(true);
      expect(invalid.length).toBe(0);
    });

    it("parses array of skills", () => {
      const { valid, invalid } = parseSkills(["inspect", "triage"]);
      expect(valid.size).toBe(2);
      expect(valid.has("inspect")).toBe(true);
      expect(valid.has("triage")).toBe(true);
      expect(invalid.length).toBe(0);
    });

    it("separates valid and invalid skills", () => {
      const { valid, invalid } = parseSkills(
        "inspect,invalid1,triage,invalid2",
      );
      expect(valid.size).toBe(2);
      expect(valid.has("inspect")).toBe(true);
      expect(valid.has("triage")).toBe(true);
      expect(invalid).toEqual(["invalid1", "invalid2"]);
    });

    it("trims whitespace from skills", () => {
      const { valid, invalid } = parseSkills(" inspect , triage , docs ");
      expect(valid.size).toBe(3);
      expect(valid.has("inspect")).toBe(true);
      expect(invalid.length).toBe(0);
    });

    it("handles empty input", () => {
      const { valid, invalid } = parseSkills("");
      expect(valid.size).toBe(0);
      expect(invalid.length).toBe(0);
    });

    it("handles null/undefined input", () => {
      const { valid, invalid } = parseSkills(null);
      expect(valid.size).toBe(0);
      expect(invalid.length).toBe(0);
    });

    it("ignores empty strings in array", () => {
      const { valid, invalid } = parseSkills(["inspect", "", "triage"]);
      expect(valid.size).toBe(2);
      expect(invalid.length).toBe(0);
    });
  });

  describe("hasRequiredSkills", () => {
    it("returns true when any required skill is granted", () => {
      const grantedSkills = new Set<Skill>(["inspect", "docs"]);
      expect(hasRequiredSkills(grantedSkills, ["inspect"])).toBe(true);
      expect(hasRequiredSkills(grantedSkills, ["docs"])).toBe(true);
      expect(hasRequiredSkills(grantedSkills, ["inspect", "triage"])).toBe(
        true,
      );
    });

    it("returns false when no required skills are granted", () => {
      const grantedSkills = new Set<Skill>(["inspect", "docs"]);
      expect(hasRequiredSkills(grantedSkills, ["triage"])).toBe(false);
      expect(
        hasRequiredSkills(grantedSkills, ["triage", "project-management"]),
      ).toBe(false);
    });

    it("returns false when grantedSkills is undefined", () => {
      expect(hasRequiredSkills(undefined, ["inspect"])).toBe(false);
    });

    it("returns false when requiredSkills is empty", () => {
      const grantedSkills = new Set<Skill>(["inspect"]);
      expect(hasRequiredSkills(grantedSkills, [])).toBe(false);
    });
  });
});
