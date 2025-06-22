import { Button } from "../ui/button";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";

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
    <div className="sm:p-8 p-4 flex flex-col items-center justify-center">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Blame Assistant</h1>
          <p className="text-slate-400">
            Chat with your stack traces. Argue with confidence. Lose gracefully.
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
