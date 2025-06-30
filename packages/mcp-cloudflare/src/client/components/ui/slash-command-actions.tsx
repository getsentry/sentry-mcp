/**
 * Component for rendering clickable slash command buttons
 */
import { Button } from "./button";
import { Terminal } from "lucide-react";

interface SlashCommandActionsProps {
  onCommandSelect: (command: string) => void;
}

const SLASH_COMMANDS = [
  { command: "help", description: "Show help message" },
  { command: "prompts", description: "List available MCP prompts" },
  { command: "clear", description: "Clear all chat messages" },
  { command: "logout", description: "Log out of the current session" },
];

export function SlashCommandActions({
  onCommandSelect,
}: SlashCommandActionsProps) {
  return (
    <div className="mt-4 space-y-3">
      <h4 className="text-sm font-medium text-slate-300 mb-2">
        Try these commands:
      </h4>
      <div className="space-y-2">
        {SLASH_COMMANDS.map((cmd) => (
          <div key={cmd.command} className="flex items-center gap-3">
            <Button
              onClick={() => onCommandSelect(cmd.command)}
              size="sm"
              variant="outline"
              className="flex items-center gap-2 text-xs bg-blue-900/50 border-blue-700/50 hover:bg-blue-800/50 hover:border-blue-600/50 text-blue-300 font-mono"
            >
              <Terminal className="h-3 w-3" />/{cmd.command}
            </Button>
            <span className="text-xs text-slate-400">{cmd.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
