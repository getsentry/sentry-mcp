import React, { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "../components/chat";

interface AuthContextType {
  isLoading: boolean;
  isAuthenticated: boolean;
  authToken: string;
  isAuthenticating: boolean;
  authError: string;
  handleOAuthLogin: () => void;
  handleLogout: () => void;
  clearAuthState: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const authState = useAuth();

  return (
    <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
