"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useCallback } from "react";
import { AuthForm, ChatUI } from ".";
import { useAuth } from "../../contexts/auth-context";
import { Bot, Loader2, LogOut, PanelLeftOpen, Sparkles } from "lucide-react";
import type { ChatProps } from "./types";
import { usePersistedChat } from "../../hooks/use-persisted-chat";
import TOOL_DEFINITIONS from "@sentry/mcp-server/toolDefinitions";
import { useMcpMetadata } from "../../hooks/use-mcp-metadata";
import { useStreamingSimulation } from "../../hooks/use-streaming-simulation";
import { SlidingPanel } from "../ui/sliding-panel";
import { isAuthError } from "../../utils/chat-error-handler";
import { useEndpointMode } from "../../hooks/use-endpoint-mode";
import { Button } from "../ui/button";

// We don't need user info since we're using MCP tokens
// The MCP server handles all Sentry authentication internally

export function Chat({ isOpen, onClose, onLogout }: ChatProps) {
  const { isLoading, isAuthenticated, authError, handleOAuthLogin } = useAuth();

  // Use endpoint mode hook to manage MCP endpoint preference
  const { endpointMode, toggleEndpointMode } = useEndpointMode();

  // Use persisted chat to save/load messages from localStorage
  const { initialMessages, saveMessages, clearPersistedMessages } =
    usePersistedChat(isAuthenticated);

  // Fetch MCP metadata immediately when authenticated
  const {
    metadata: mcpMetadata,
    isLoading: isMetadataLoading,
    error: metadataError,
  } = useMcpMetadata(isAuthenticated);

  // Initialize streaming simulation first (without scroll callback)
  const {
    isStreaming: isLocalStreaming,
    startStreaming,
    isMessageStreaming,
  } = useStreamingSimulation();

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    stop,
    error,
    reload,
    setMessages,
    setInput,
    append,
  } = useChat({
    api: "/api/chat",
    // No auth header needed - server reads from cookie
    // No ID to disable useChat's built-in persistence
    // We handle persistence manually via usePersistedChat hook
    initialMessages,
    // Enable sending the data field with messages for custom message types
    sendExtraMessageFields: true,
    // Pass endpoint mode to the API
    body: {
      endpointMode,
    },
  });

  // No need for custom scroll handling - react-scroll-to-bottom handles it

  // Clear messages function - used locally for /clear command and logout
  const clearMessages = useCallback(() => {
    setMessages([]);
    clearPersistedMessages();
  }, [setMessages, clearPersistedMessages]);

  // Get MCP metadata from the dedicated endpoint
  const getMcpMetadata = useCallback(() => {
    return mcpMetadata;
  }, [mcpMetadata]);

  // Generate tools-based messages for custom commands
  const createToolsMessage = useCallback(() => {
    const metadata = getMcpMetadata();

    let content: string;
    let messageMetadata: Record<string, unknown>;

    if (isMetadataLoading) {
      content = "🔄 Loading tools from MCP server...";
      messageMetadata = { type: "tools-loading" };
    } else if (metadataError) {
      content = `❌ Failed to load tools: ${metadataError}\n\nPlease check your connection and try again.`;
      messageMetadata = { type: "tools-error", error: metadataError };
    } else if (!metadata || !metadata.tools || !Array.isArray(metadata.tools)) {
      content =
        "No tools are currently available. The MCP server may not have loaded tools yet.\n\nPlease check your connection and try again.";
      messageMetadata = { type: "tools-empty" };
    } else {
      // Build detailed tool list for UI component rendering
      const definitionsByName = new Map(
        TOOL_DEFINITIONS.map((t) => [t.name, t]),
      );
      const detailed = metadata.tools
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .map((name) => {
          const def = definitionsByName.get(name);
          return {
            name,
            description: def ? def.description.split("\n")[0] : "",
          } as { name: string; description: string };
        });

      content =
        "These tools are available right now. Ask the assistant to use one.\n\nNote: This list reflects the permissions you approved during sign‑in. Granting additional scopes will enable more tools.";
      messageMetadata = {
        type: "tools-list",
        tools: metadata.tools,
        toolsDetailed: detailed,
      };
    }

    return {
      content,
      data: messageMetadata,
    };
  }, [getMcpMetadata, isMetadataLoading, metadataError]);

  const createHelpMessage = useCallback(() => {
    const content = `Welcome to the Sentry Model Context Protocol chat interface! This AI assistant helps you test and explore Sentry functionality.

## Available Slash Commands

- **\`/help\`** - Show this help message
- **\`/tools\`** - List all available MCP tools
- **\`/clear\`** - Clear all chat messages
- **\`/logout\`** - Log out of the current session

## What I Can Help With

🔍 **Explore Your Sentry Data**
- Browse organizations, projects, and teams
- Find recent issues and errors
- Analyze performance data and releases

🛠️ **Test MCP Tools**
- Demonstrate how MCP tools work with your data
- Search for specific errors in files
- Get detailed issue information

🤖 **Try Sentry's AI Features**
- Use Seer for automatic issue analysis and fixes
- Get AI-powered debugging suggestions
- Generate fix recommendations

## Getting Started

Try asking me things like:
- "What organizations do I have access to?"
- "Show me my recent issues"
- "Help me find errors in my React components"
- "Use Seer to analyze issue ABC-123"

**Need more help?** Visit [Sentry Documentation](https://docs.sentry.io/) or check out our [careers page](https://sentry.io/careers/) if you're interested in working on projects like this! 🐱`;

    return {
      content,
      data: {
        type: "help-message",
        hasSlashCommands: true,
      },
    };
  }, []);

  // Track previous auth state to detect logout events
  const prevAuthStateRef = useRef(isAuthenticated);

  // Clear messages when user logs out (auth state changes from authenticated to not)
  useEffect(() => {
    const wasAuthenticated = prevAuthStateRef.current;

    // Detect logout: was authenticated but now isn't
    if (wasAuthenticated && !isAuthenticated) {
      clearMessages();
    }

    // Update the ref for next comparison
    prevAuthStateRef.current = isAuthenticated;
  }, [isAuthenticated, clearMessages]);

  // Save messages when they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages, saveMessages]);

  // Track if we had an auth error before
  const hadAuthErrorRef = useRef(false);
  const wasAuthenticatedRef = useRef(isAuthenticated);

  // Handle auth error detection and retry after reauthentication
  useEffect(() => {
    // If we get an auth error, record it
    if (error && isAuthError(error) && !hadAuthErrorRef.current) {
      hadAuthErrorRef.current = true;
    }

    // If we had an auth error and just re-authenticated, retry once
    if (
      hadAuthErrorRef.current &&
      !wasAuthenticatedRef.current &&
      isAuthenticated
    ) {
      hadAuthErrorRef.current = false;
      // Retry the failed message
      reload();
    }

    // Reset retry state on successful completion (no error)
    if (!error) {
      hadAuthErrorRef.current = false;
    }

    // Update auth state ref
    wasAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated, error, reload]);

  // Handle slash commands
  const handleSlashCommand = useCallback(
    (command: string) => {
      // Always clear the input first for all commands
      setInput("");

      // Add the slash command as a user message first
      const userMessage = {
        id: Date.now().toString(),
        role: "user" as const,
        content: `/${command}`,
        createdAt: new Date(),
      };

      if (command === "clear") {
        // Clear everything
        clearMessages();
      } else if (command === "logout") {
        // Add message, then logout
        setMessages((prev: any[]) => [...prev, userMessage]);
        onLogout();
      } else if (command === "help") {
        // Add user message first
        setMessages((prev: any[]) => [...prev, userMessage]);

        // Create help message with metadata and add after a brief delay for better UX
        setTimeout(() => {
          const helpMessageData = createHelpMessage();
          const helpMessage = {
            id: (Date.now() + 1).toString(),
            role: "system" as const,
            content: helpMessageData.content,
            createdAt: new Date(),
            data: { ...helpMessageData.data, simulateStreaming: true },
          };
          setMessages((prev) => [...prev, helpMessage]);

          // Start streaming simulation
          startStreaming(helpMessage.id, 1200);
        }, 100);
      } else if (command === "tools") {
        // Add user message first
        setMessages((prev: any[]) => [...prev, userMessage]);

        // Create tools message
        setTimeout(() => {
          const toolsMessageData = createToolsMessage();
          const toolsMessage = {
            id: (Date.now() + 1).toString(),
            role: "system" as const,
            content: toolsMessageData.content,
            createdAt: new Date(),
            data: { ...toolsMessageData.data, simulateStreaming: true },
          };
          setMessages((prev) => [...prev, toolsMessage]);

          startStreaming(toolsMessage.id, 600);
        }, 100);
      } else {
        // Handle unknown slash commands - add user message and error
        const errorMessage = {
          id: (Date.now() + 1).toString(),
          role: "system" as const,
          content: `Unknown command: /${command}. Available commands: /help, /tools, /clear, /logout`,
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, userMessage, errorMessage]);
      }
    },
    [
      clearMessages,
      onLogout,
      setInput,
      setMessages,
      createHelpMessage,
      createToolsMessage,
      startStreaming,
    ],
  );

  // Handle sending a prompt programmatically
  const handleSendPrompt = useCallback(
    (prompt: string) => {
      // Check if prompt is a slash command
      if (prompt.startsWith("/")) {
        const command = prompt.slice(1).toLowerCase().trim();
        handleSlashCommand(command);
        return;
      }

      // Clear the input and directly send the message using append
      append({ role: "user", content: prompt });
    },
    [append, handleSlashCommand],
  );

  // Wrap form submission to ensure scrolling
  const handleFormSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      handleSubmit(e);
    },
    [handleSubmit],
  );

  // Show loading state while checking auth session
  if (isLoading) {
    return (
      <SlidingPanel isOpen={isOpen} onClose={onClose}>
        <div className="h-full flex items-center justify-center">
          <div className="animate-pulse text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>
      </SlidingPanel>
    );
  }

  // Use a single SlidingPanel and transition between auth and chat states
  return (
    <SlidingPanel isOpen={isOpen} onClose={onClose}>
      {/* Auth form with fade transition */}
      <div
        className={`absolute inset-0 h-full flex flex-col items-center justify-center duration-500 ease-in-out ${
          !isAuthenticated
            ? "visible scale-100 opacity-100 pointer-events-auto"
            : "hidden motion-safe:scale-95 opacity-0 pointer-events-none"
        }`}
      >
        <AuthForm authError={authError} onOAuthLogin={handleOAuthLogin} />
      </div>

      {/* {showControls && ( */}
      <div className="w-full [mask-image:linear-gradient(to_bottom,red,transparent)] pointer-events-none absolute top-0 left-0 h-20 z-10 backdrop-blur-md bg-gradient-to-b from-background to-background/20 xl:from-background-2 xl:to-[#20163333]" />
      <div className="flex flex-row sm:grid sm:grid-cols-3 xl:flex xl:flex-row-reverse justify-between items-center absolute left-4 right-6 top-4 gap-4 z-20">
        {isAuthenticated && toggleEndpointMode ? (
          <Button
            type="button"
            onClick={toggleEndpointMode}
            variant={endpointMode === "agent" ? "default" : "outline"}
            title={
              endpointMode === "agent"
                ? "Agent mode: Only use_sentry tool (click to switch to standard)"
                : "Standard mode: All 19 tools available (click to switch to agent)"
            }
            className={`shadow-lg max-xl:order-2 rounded-xl backdrop-blur ${
              endpointMode === "agent" ? "ring-4 ring-violet-300/50" : "ring-0"
            }`}
          >
            {endpointMode === "agent" ? (
              <>
                <Sparkles className="size-4" />
                Agent Mode
              </>
            ) : (
              <>
                <Bot className="size-4" />
                Standard Mode
              </>
            )}
          </Button>
        ) : (
          <div />
        )}
        <div className="contents xl:flex gap-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            size="icon"
            title="Close"
            className="rounded-xl max-xl:order-3 max-xl:ml-auto hover:scale-110 active:scale-90 active:duration-75 bg-background-2 xl:bg-background-3 hover:bg-violet-300 duration-300 transition-[color_ease,background-color_ease,scale_cubic-bezier(0.175,0.885,0.32,1.275)]"
          >
            <span className="sr-only">Logout</span>
            <PanelLeftOpen className="size-4" />
          </Button>
          {isAuthenticated && onLogout ? (
            <Button
              variant="secondary"
              onClick={onLogout}
              className="cursor-pointer max-xl:order-1 max-xl:mr-auto rounded-xl bg-background-2 xl:bg-background-3"
            >
              <LogOut className="size-4" />
              <span className="max-sm:sr-only">Logout</span>
            </Button>
          ) : (
            <div />
          )}
        </div>
      </div>

      {/* Chat UI with fade transition */}
      <div
        className={`absolute inset-0 transition-all duration-500 ease-in-out ${
          isAuthenticated
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        style={{
          visibility: isAuthenticated ? "visible" : "hidden",
          transitionProperty: "opacity, transform",
          transform: isAuthenticated ? "scale(1)" : "scale(1.05)",
        }}
      >
        <ChatUI
          messages={messages}
          input={input}
          error={error}
          isChatLoading={status === "streaming" || status === "submitted"}
          isLocalStreaming={isLocalStreaming}
          isMessageStreaming={isMessageStreaming}
          isOpen={isOpen}
          onInputChange={handleInputChange}
          onSubmit={handleFormSubmit}
          onStop={stop}
          onRetry={reload}
          onSlashCommand={handleSlashCommand}
          onSendPrompt={handleSendPrompt}
        />
      </div>
    </SlidingPanel>
  );
}
