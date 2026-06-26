import { Prose } from "../ui/prose";
import InstallTabs, { Tab } from "./install-tabs";
// Import IDE instruction components
import { ClaudeCodeInstructions } from "./instructions/claude-code";
import { CursorInstructions } from "./instructions/cursor";
import { VSCodeInstructions } from "./instructions/vscode";
import { CodexCLIInstructions } from "./instructions/codex-cli";
import { AmpInstructions } from "./instructions/amp";
import { GeminiInstructions } from "./instructions/gemini";
import { OpenCodeInstructions } from "./instructions/opencode";
import { WarpInstructions } from "./instructions/warp";
import { WindsurfInstructions } from "./instructions/windsurf";
import { ZedInstructions } from "./instructions/zed";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

export default function RemoteSetup() {
  const endpoint = new URL("/mcp", window.location.href).href;
  return (
    <>
      <Prose className="mb-6">
        <p>
          <strong>Path Constraints:</strong> Restrict the session to a specific
          organization or project by adding them to the URL path. This ensures
          all skills operate within the specified scope.
        </p>
        <ul>
          <li>
            <code>/:organization</code> — Limit to one organization
          </li>
          <li>
            <code>/:organization/:project</code> — Limit to a specific project
          </li>
        </ul>
        <p>
          <small>
            Note: When using path constraints, some tools are automatically
            hidden: <code>find_organizations</code> is excluded with org
            constraints, and <code>find_projects</code> is excluded with project
            constraints.
          </small>
        </p>
        <p>
          <strong>Agent Mode:</strong> Reduce context by exposing a single{" "}
          <code>use_sentry</code> tool instead of individual skills. The
          embedded AI agent handles natural language requests and automatically
          chains tool calls as needed. Note: Agent mode approximately doubles
          response time due to the embedded AI layer.
        </p>
        <ul>
          <li>
            <code>?agent=1</code> — Enable agent mode (works with path
            constraints)
          </li>
        </ul>
      </Prose>
    </>
  );
}

interface RemoteSetupTabsProps {
  selectedIde?: string;
  onIdeChange?: (ide: string) => void;
}

export function RemoteSetupTabs({
  selectedIde,
  onIdeChange,
}: RemoteSetupTabsProps) {
  return (
    <InstallTabs selectedTab={selectedIde} onTabChange={onIdeChange}>
      <Tab id="claude-code" title="Claude Code">
        <ClaudeCodeInstructions transport="cloud" />
      </Tab>

      <Tab id="cursor" title="Cursor">
        <CursorInstructions transport="cloud" />
      </Tab>

      <Tab id="vscode" title="VSCode">
        <VSCodeInstructions transport="cloud" />
      </Tab>

      <Tab id="codex-cli" title="Codex">
        <CodexCLIInstructions transport="cloud" />
      </Tab>

      <Tab id="amp" title="Amp">
        <AmpInstructions transport="cloud" />
      </Tab>

      <Tab id="gemini" title="Gemini CLI">
        <GeminiInstructions transport="cloud" />
      </Tab>

      <Tab id="opencode" title="OpenCode">
        <OpenCodeInstructions transport="cloud" />
      </Tab>

      <Tab id="warp" title="Warp">
        <WarpInstructions transport="cloud" />
      </Tab>

      <Tab id="windsurf" title="Windsurf">
        <WindsurfInstructions transport="cloud" />
      </Tab>

      <Tab id="zed" title="Zed">
        <ZedInstructions transport="cloud" />
      </Tab>
    </InstallTabs>
  );
}
