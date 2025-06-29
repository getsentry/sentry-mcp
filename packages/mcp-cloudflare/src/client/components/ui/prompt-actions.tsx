/**
 * Component for rendering clickable prompt action buttons
 */
import { Button } from "./button";
import { Play } from "lucide-react";

interface PromptParameter {
  type: string;
  required: boolean;
  description?: string;
}

interface PromptInfo {
  name: string;
  description: string;
  parameters: Record<string, PromptParameter>;
}

interface PromptActionsProps {
  prompts: PromptInfo[];
  onPromptSelect: (prompt: PromptInfo) => void;
}

export function PromptActions({ prompts, onPromptSelect }: PromptActionsProps) {
  if (!prompts || prompts.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      <h4 className="text-sm font-medium text-slate-300 mb-2">
        Available Actions:
      </h4>
      <div className="space-y-3">
        {prompts.map((prompt) => (
          <div key={prompt.name} className="space-y-2">
            <Button
              onClick={() => onPromptSelect(prompt)}
              size="sm"
              variant="outline"
              className="flex items-center gap-2 text-xs bg-slate-800 border-slate-600 hover:bg-slate-700 hover:border-slate-500"
            >
              <Play className="h-3 w-3" />
              {prompt.name}
            </Button>
            <p className="text-xs text-slate-400 ml-1">{prompt.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
