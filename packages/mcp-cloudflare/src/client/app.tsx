import { Header } from "./components/ui/header";
import { useState, useEffect } from "react";
import { Chat } from "./components/chat";
import { useAuthContext } from "./contexts/auth-context";
import Home from "./pages/home";

export default function App() {
  const { isAuthenticated, handleLogout } = useAuthContext();

  const [isChatOpen, setIsChatOpen] = useState(() => {
    // Initialize based on URL query string only to avoid hydration issues
    const urlParams = new URLSearchParams(window.location.search);
    const hasQueryParam = urlParams.has("chat");

    if (hasQueryParam) {
      return urlParams.get("chat") !== "0";
    }

    // Default based on screen size to avoid flash on mobile
    // Note: This is safe for SSR since we handle the correction in useEffect
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768; // Desktop: open, Mobile: closed
    }

    // SSR fallback - default to true for desktop-first approach
    return true;
  });

  // Adjust initial state for mobile after component mounts
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);

    // Only adjust state if no URL parameter exists and we're on mobile
    if (!urlParams.has("chat") && window.innerWidth < 768) {
      setIsChatOpen(false);
    }
  }, []);

  // Update URL when chat state changes
  const toggleChat = (open: boolean) => {
    setIsChatOpen(open);

    if (open) {
      // Add ?chat to URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("chat", "1");
      window.history.pushState({}, "", newUrl.toString());
    } else {
      // Remove query string for home page
      const newUrl = new URL(window.location.href);
      newUrl.search = "";
      window.history.pushState({}, "", newUrl.toString());
    }
  };

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const hasQueryParam = urlParams.has("chat");

      if (hasQueryParam) {
        setIsChatOpen(urlParams.get("chat") !== "0");
      } else {
        // Default to open on desktop, closed on mobile
        setIsChatOpen(window.innerWidth >= 768);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Handle window resize to adjust chat state appropriately
  useEffect(() => {
    const handleResize = () => {
      // If no explicit URL state, adjust based on screen size
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.has("chat")) {
        const isDesktop = window.innerWidth >= 768;
        setIsChatOpen(isDesktop); // Open on desktop, closed on mobile
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="min-h-screen text-white">
      {/* Mobile layout: Single column with overlay chat */}
      <div className="md:hidden h-screen flex flex-col">
        <div className="flex-1 overflow-y-auto sm:p-8 p-4">
          <div className="max-w-3xl mx-auto">
            <Header isAuthenticated={isAuthenticated} onLogout={handleLogout} />
            <Home onChatClick={() => toggleChat(true)} />
          </div>
        </div>
      </div>

      {/* Desktop layout: Main content adjusts width based on chat state */}
      <div className="hidden md:flex h-screen">
        <div
          className={`flex flex-col ${isChatOpen ? "w-1/2" : "flex-1"} md:transition-all md:duration-300`}
        >
          <div className="flex-1 overflow-y-auto sm:p-8 p-4">
            <div className="max-w-3xl mx-auto">
              <Header
                isAuthenticated={isAuthenticated}
                onLogout={handleLogout}
              />
              <Home onChatClick={() => toggleChat(true)} />
            </div>
          </div>
        </div>
      </div>

      {/* Single Chat component - handles both mobile and desktop layouts */}
      <Chat isOpen={isChatOpen} onClose={() => toggleChat(false)} />
    </div>
  );
}
