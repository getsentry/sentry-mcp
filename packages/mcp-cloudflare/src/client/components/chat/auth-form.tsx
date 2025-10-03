import { Button } from "../ui/button";
import { AlertCircle } from "lucide-react";

import type { AuthFormProps } from "./types";

export function AuthForm({ authError, onOAuthLogin }: AuthFormProps) {
  return (
    <div className="sm:p-8 p-4 flex flex-col items-center">
      <div className="max-w-md w-full space-y-6">
        {/* Chat illustration - hidden on short screens */}
        <div className=" hidden [@media(min-height:500px)]:block">
          <img
            src="/flow-transparent.png"
            alt="Flow"
            width={1536}
            height={1024}
            className="w-full mb-6 bg-violet-300 rounded-xl"
            draggable={false}
          />
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-white">Live MCP Demo</h1>
          <p className="">
            Connect your Sentry account to test the Model Context Protocol with
            real data from your projects.
          </p>
        </div>

        <div className="space-y-4">
          {authError && (
            <div className="p-3 bg-red-900/20 border border-red-500/30 rounded flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <div className="text-red-400 text-sm">{authError}</div>
            </div>
          )}

          <Button
            onClick={onOAuthLogin}
            variant="default"
            className="w-full cursor-pointer rounded-xl"
          >
            Connect with Sentry
          </Button>
        </div>
      </div>
    </div>
  );
}
