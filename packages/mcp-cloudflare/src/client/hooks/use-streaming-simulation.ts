/**
 * Hook for simulating streaming animation for local messages (like slash commands)
 * This provides the same UX as AI-generated responses for locally generated content
 */
import { useState, useCallback, useRef, useEffect } from "react";

interface StreamingSimulationState {
  isStreaming: boolean;
  streamingMessageId: string | null;
}

export function useStreamingSimulation() {
  const [state, setState] = useState<StreamingSimulationState>({
    isStreaming: false,
    streamingMessageId: null,
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start streaming simulation for a specific message
  const startStreaming = useCallback((messageId: string, duration = 1000) => {
    setState({
      isStreaming: true,
      streamingMessageId: messageId,
    });

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Stop streaming after the specified duration
    timeoutRef.current = setTimeout(() => {
      setState({
        isStreaming: false,
        streamingMessageId: null,
      });
    }, duration);
  }, []);

  // Stop streaming simulation immediately
  const stopStreaming = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setState({
      isStreaming: false,
      streamingMessageId: null,
    });
  }, []);

  // Check if a specific message is currently streaming
  const isMessageStreaming = useCallback(
    (messageId: string) => {
      return state.isStreaming && state.streamingMessageId === messageId;
    },
    [state.isStreaming, state.streamingMessageId],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    isStreaming: state.isStreaming,
    streamingMessageId: state.streamingMessageId,
    startStreaming,
    stopStreaming,
    isMessageStreaming,
  };
}
