import { describe, expect, test, vi } from "vitest";
import {
  chooseProjectTeam,
  type ProjectTeamSelect,
} from "../../src/lib/team-choice.js";
import type { SentryTeam } from "../../src/types/index.js";

const platform: SentryTeam = {
  id: "1",
  slug: "platform",
  name: "Platform",
  access: ["team:admin"],
};
const web: SentryTeam = {
  id: "2",
  slug: "web",
  name: "Web",
  access: ["team:admin"],
};

function makeSelect(...answers: string[]): {
  calls: Parameters<ProjectTeamSelect>[0][];
  select: ProjectTeamSelect;
} {
  const calls: Parameters<ProjectTeamSelect>[0][] = [];
  const select: ProjectTeamSelect = vi.fn(async (options) => {
    calls.push(options);
    const answer = answers.shift();
    const selected = options.options.find((option) => option.value === answer);
    if (!selected) {
      throw new Error(`Missing test option: ${answer}`);
    }
    return selected.value;
  });
  return { calls, select };
}

describe("chooseProjectTeam", () => {
  test("shows create first and the only eligible team directly", async () => {
    const prompt = makeSelect("existing");

    const result = await chooseProjectTeam([platform], prompt.select);

    expect(result).toEqual({ kind: "existing", slug: "platform" });
    expect(prompt.calls).toHaveLength(1);
    expect(prompt.calls[0]?.options).toEqual([
      {
        value: "create",
        label: "+ Create a new team",
      },
      {
        value: "existing",
        label: "Use #platform",
      },
    ]);
    expect(prompt.calls[0]?.initialValue).toBe("existing");
  });

  test("keeps create outside the team selector when several teams exist", async () => {
    const prompt = makeSelect("existing", "web");

    const result = await chooseProjectTeam([platform, web], prompt.select);

    expect(result).toEqual({ kind: "existing", slug: "web" });
    expect(prompt.calls).toHaveLength(2);
    expect(prompt.calls[0]?.options).toEqual([
      { value: "create", label: "+ Create a new team" },
      { value: "existing", label: "Select an existing team" },
    ]);
    expect(prompt.calls[1]?.message).toBe("Select an existing team");
    expect(prompt.calls[1]?.options).toEqual([
      { value: "platform", label: "#platform", hint: "Platform" },
      { value: "web", label: "#web", hint: "Web" },
    ]);
    expect(
      prompt.calls[1]?.options.some((option) => option.value === "create")
    ).toBe(false);
  });

  test("does not open the team selector after create is chosen", async () => {
    const prompt = makeSelect("create");

    const result = await chooseProjectTeam([platform, web], prompt.select);

    expect(result).toEqual({ kind: "create" });
    expect(prompt.calls).toHaveLength(1);
  });
});
