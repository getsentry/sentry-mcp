import { describe, expect, it } from "vitest";
import { parseClaudeMcpGetStatus, parseCodexMcpListRow } from "./providers.js";
import { WHOAMI_SCENARIO } from "./scenarios.js";

describe("parseClaudeMcpGetStatus", () => {
  it("extracts the status line from claude mcp get output", () => {
    expect(
      parseClaudeMcpGetStatus(`sentry-dev:
  Scope: Project config (shared via .mcp.json)
  Status: ✗ Failed to connect
  Type: http`),
    ).toBe("✗ Failed to connect");
  });
});

describe("parseCodexMcpListRow", () => {
  it("parses the configured server row from codex mcp list output", () => {
    expect(
      parseCodexMcpListRow(
        `Name        Url                                                          Bearer Token Env Var  Status   Auth
sentry      https://mcp.sentry.dev/mcp/sentry/mcp-server?experimental=1  -                     enabled  Not logged in
sentry-dev  http://localhost:5173/mcp/sentry/mcp-server?experimental=1   -                     enabled  Logged in`,
        "sentry-dev",
      ),
    ).toEqual({
      name: "sentry-dev",
      status: "enabled",
      auth: "Logged in",
      details: [
        "http://localhost:5173/mcp/sentry/mcp-server?experimental=1",
        "-",
      ],
    });
  });

  it("parses the configured stdio server row from codex mcp list output", () => {
    expect(
      parseCodexMcpListRow(
        `Name          Command  Args                               Env                          Cwd  Status   Auth
sentry-stdio  node     ../../../mcp-server/dist/index.js  SENTRY_MCP_AUTH_CACHE=*****  -    enabled  Unsupported`,
        "sentry-stdio",
      ),
    ).toEqual({
      name: "sentry-stdio",
      status: "enabled",
      auth: "Unsupported",
      details: [
        "node",
        "../../../mcp-server/dist/index.js",
        "SENTRY_MCP_AUTH_CACHE=*****",
        "-",
      ],
    });
  });
});

describe("WHOAMI_SCENARIO", () => {
  it("builds a prompt that targets whoami on a named MCP server", () => {
    expect(WHOAMI_SCENARIO.buildPrompt("sentry-dev")).toContain(
      '"whoami" tool from the MCP server named "sentry-dev"',
    );
  });

  it("extracts an email from the final output", () => {
    expect(
      WHOAMI_SCENARIO.validate("The authenticated email is david@sentry.io."),
    ).toEqual({
      passed: true,
      summary: "Authenticated email: david@sentry.io",
      email: "david@sentry.io",
    });
  });

  it("fails when no email is present", () => {
    expect(WHOAMI_SCENARIO.validate("I could not authenticate.")).toEqual({
      passed: false,
      summary: "No authenticated email address found in the final response.",
    });
  });
});
