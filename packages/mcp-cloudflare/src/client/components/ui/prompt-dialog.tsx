/**
 * Dialog component for inputting MCP prompt parameters
 */
import { useState, useCallback, useEffect } from "react";
import { Button } from "./button";
import { X } from "lucide-react";

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

interface PromptDialogProps {
  prompt: PromptInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onExecute: (promptName: string, parameters: Record<string, string>) => void;
}

export function PromptDialog({
  prompt,
  isOpen,
  onClose,
  onExecute,
}: PromptDialogProps) {
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleParameterChange = useCallback(
    (name: string, value: string) => {
      setParameters((prev) => ({ ...prev, [name]: value }));
      // Clear error when user starts typing
      if (errors[name]) {
        setErrors((prev) => ({ ...prev, [name]: "" }));
      }
    },
    [errors],
  );

  const validateParameters = useCallback(() => {
    if (!prompt) return false;

    const newErrors: Record<string, string> = {};

    for (const [name, param] of Object.entries(prompt.parameters)) {
      if (
        param.required &&
        (!parameters[name] || parameters[name].trim() === "")
      ) {
        newErrors[name] = `${name} is required`;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [prompt, parameters]);

  const handleExecute = useCallback(() => {
    if (!prompt || !validateParameters()) return;

    onExecute(prompt.name, parameters);
    onClose();
    setParameters({});
    setErrors({});
  }, [prompt, parameters, validateParameters, onExecute, onClose]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleExecute();
    },
    [handleExecute],
  );

  const handleCancel = useCallback(() => {
    onClose();
    setParameters({});
    setErrors({});
  }, [onClose]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleCancel();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, handleCancel]);

  // Handle click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleCancel();
      }
    },
    [handleCancel],
  );

  if (!isOpen || !prompt) return null;

  const hasParameters = Object.keys(prompt.parameters).length > 0;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
      onKeyDown={undefined}
      role="presentation"
    >
      <div className="bg-slate-900 rounded border border-slate-700 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Execute Prompt</h2>
          <Button
            onClick={handleCancel}
            size="icon"
            variant="ghost"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form wrapping both content and footer */}
        <form onSubmit={handleSubmit}>
          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Prompt info */}
            <div>
              <h3 className="font-medium text-white mb-2">{prompt.name}</h3>
              <p className="text-sm text-slate-400">{prompt.description}</p>
            </div>

            {/* Parameters form */}
            {hasParameters ? (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-white">Parameters</h4>
                {Object.entries(prompt.parameters).map(([name, param]) => {
                  const inputId = `param-${name}`;
                  return (
                    <div key={name} className="space-y-1">
                      <label
                        htmlFor={inputId}
                        className="block text-sm text-slate-300"
                      >
                        {name}
                        {param.required && (
                          <span className="text-red-400 ml-1">*</span>
                        )}
                        {param.type && (
                          <span className="text-slate-500 ml-1">
                            ({param.type})
                          </span>
                        )}
                      </label>
                      {param.description && (
                        <p className="text-xs text-slate-500 mb-2">
                          {param.description}
                        </p>
                      )}
                      <input
                        id={inputId}
                        type="text"
                        value={parameters[name] || ""}
                        onChange={(e) =>
                          handleParameterChange(name, e.target.value)
                        }
                        className={`w-full px-3 py-1.5 text-sm bg-slate-800 border rounded text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          errors[name] ? "border-red-500" : "border-slate-600"
                        }`}
                        placeholder={`Enter ${name}...`}
                      />
                      {errors[name] && (
                        <p className="text-xs text-red-400">{errors[name]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                This prompt doesn't require any parameters.
              </p>
            )}
          </div>

          {/* Footer inside form */}
          <div className="flex justify-end gap-2 p-4 border-t border-slate-700">
            <Button
              type="button"
              onClick={handleCancel}
              variant="outline"
              size="sm"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Execute Prompt
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
