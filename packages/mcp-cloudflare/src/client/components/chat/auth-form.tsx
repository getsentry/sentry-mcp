import { Button } from "../ui/button";
import { AlertCircle, Loader2 } from "lucide-react";

interface AuthFormProps {
  authError: string;
  isAuthenticating: boolean;
  onOAuthLogin: () => void;
}

export function AuthForm({
  authError,
  isAuthenticating,
  onOAuthLogin,
}: AuthFormProps) {
  return (
    <div className="sm:p-8 p-4 flex flex-col items-center">
      <div className="max-w-md w-full space-y-6">
        {/* Chat illustration - hidden on short screens */}
        <div className="text-slate-400 hidden [@media(min-height:500px)]:block">
          <img
            src="/flow-transparent.png"
            alt="Flow"
            className="w-full mb-6 bg-violet-300 rounded"
          />
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Live MCP Demo</h1>
          <p className="text-slate-400">
            Connect your Sentry account to test the Model Context Protocol with
            real data from your projects.
          </p>
        </div>

        <div className="space-y-4">
          {authError && (
            <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <div className="text-red-400 text-sm">{authError}</div>
            </div>
          )}

          <Button
            onClick={onOAuthLogin}
            disabled={isAuthenticating}
            variant="default"
            className="w-full cursor-pointer"
          >
            {isAuthenticating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Connecting...
              </>
            ) : (
              "Connect with Sentry"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
