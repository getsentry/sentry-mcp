/**
 * Interactive project-team choice shared by `sentry init` and
 * `sentry project create`.
 *
 * Creating a team is a top-level action, never an item appended to the team
 * selector. This keeps the action visible even when the organization has a
 * long team list.
 */

export type ProjectTeamChoice =
  | { kind: "create" }
  | { kind: "existing"; slug: string };

/** Team fields needed by the project-creation prompt. */
export type ProjectTeamOption = Readonly<{
  slug: string;
  name: string;
}>;

export type ProjectTeamSelectOptions<T extends string> = {
  message: string;
  options: { value: T; label: string; hint?: string }[];
  initialValue?: T;
};

/** Narrow prompt capability required by the shared team-choice flow. */
export type ProjectTeamSelect = <T extends string>(
  options: ProjectTeamSelectOptions<T>
) => Promise<T>;

/**
 * Ask whether to create a team or use an existing Team Admin team.
 *
 * With one eligible team, that team is shown directly in the top-level
 * decision. With several, choosing the existing-team action opens a second
 * prompt containing only teams.
 */
export async function chooseProjectTeam(
  teams: readonly ProjectTeamOption[],
  select: ProjectTeamSelect
): Promise<ProjectTeamChoice> {
  const onlyTeam = teams.length === 1 ? teams[0] : undefined;
  const existingLabel = onlyTeam
    ? `Use #${onlyTeam.slug}`
    : "Select an existing team";

  const intent = await select<"create" | "existing">({
    message: "Choose a team for the new project",
    options: [
      {
        value: "create",
        label: "+ Create a new team",
      },
      {
        value: "existing",
        label: existingLabel,
      },
    ],
    ...(onlyTeam ? { initialValue: "existing" } : {}),
  });

  if (intent === "create") {
    return { kind: "create" };
  }
  if (onlyTeam) {
    return { kind: "existing", slug: onlyTeam.slug };
  }

  const slug = await select({
    message: "Select an existing team",
    options: teams.map((team) => ({
      value: team.slug,
      label: `#${team.slug}`,
      ...(team.name !== team.slug ? { hint: team.name } : {}),
    })),
  });
  return { kind: "existing", slug };
}
