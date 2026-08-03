/** Tests for generated command-heading and example association parsing. */

import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import {
  extractCommandPathFromHeading,
  matchExampleToCommand,
} from "../../script/generate-skill-markdown.js";

describe("extractCommandPathFromHeading", () => {
  test.each([
    ["`sentry issue view <issue-id>`", "sentry issue view"],
    [
      "`sentry project create [<org>/]<name>:<platform>...`",
      "sentry project create",
    ],
    ["`sentry auth status`", "sentry auth status"],
  ])("extracts the command path from %s", (heading, expected) => {
    expect(extractCommandPathFromHeading(heading)).toBe(expected);
  });

  test("ignores descriptive headings", () => {
    expect(extractCommandPathFromHeading("Create a project")).toBeUndefined();
  });
});

describe("matchExampleToCommand", () => {
  test("associates a project create block with its command", () => {
    const code = [
      "# Create projects",
      "sentry project create web:javascript api:python-django",
    ].join("\n");

    expect(
      matchExampleToCommand(
        code,
        ["sentry project create", "sentry project delete"],
        "sentry project"
      )
    ).toBe("sentry project create");
  });

  test("the generated project reference retains create examples", async () => {
    const reference = await readFile(
      "plugins/sentry-cli/skills/sentry-cli/references/project.md",
      "utf8"
    );

    expect(reference).toContain(
      "### `sentry project create [<org>/]<name>:<platform>...`"
    );
    expect(reference).not.toContain('sentry project create "My New App":');
    // The platform must always be attached with ":" — no space-separated form.
    expect(reference).not.toContain(
      "sentry project create my-new-app javascript-nextjs"
    );
    expect(reference).not.toContain(
      "sentry project create my-org/my-new-app javascript-nextjs"
    );
    expect(reference).toContain(
      "sentry project create web:javascript api:python-django worker:node"
    );
    expect(reference).toContain(
      "sentry project create my-new-app:javascript-nextjs"
    );
  });
});
