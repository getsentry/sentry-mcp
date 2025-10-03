import { Header } from "./components/ui/header";
import { useState, useEffect } from "react";
import { Chat } from "./components/chat";
import { useAuth } from "./contexts/auth-context";
import Home from "./pages/home";
import TerminalAnimation from "./components/animation/TerminalAnimation";
import BackgroundDecorations from "./components/animation/BackgroundDecorations";

export default function App() {
  const { isAuthenticated, handleLogout } = useAuth();

  const [isChatOpen, setIsChatOpen] = useState(() => {
    // Initialize based on URL query string only to avoid hydration issues
    const urlParams = new URLSearchParams(window.location.search);
    const hasQueryParam = urlParams.has("chat");

    if (hasQueryParam) {
      return urlParams.get("chat") !== "0";
    }

    // default to false for mobile and to avoid scroll lock on desktop
    return false;
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

  return (
    <div className="min-h-screen overflow-x-clip max-w-screen relative text-white">
      <BackgroundDecorations />
      {/* Mobile layout: Single column with overlay chat */}
      <div className="xl:hidden flex flex-col">
        <div className="flex-1 sm:p-8 p-4">
          <div className=" mx-auto">
            <Header isAuthenticated={isAuthenticated} onLogout={handleLogout} />
            <div
              className="overflow-wrap relative grid h-[calc(100svh-5rem)] sm:h-[calc(100svh-12rem)] max-h-[69rem] w-full gap-8 overflow-hidden rounded-2xl xl:grid-cols-4 bg-gradient-to-r from-400/50 to-500 text-white/70 grid-cols-1 grid-rows-6 xl:grid-rows-1"
              id="demo"
            >
              <TerminalAnimation onChatClick={() => toggleChat(true)} />
            </div>
            <div className="pt-12">
              <Home onChatClick={() => toggleChat(true)} />
            </div>
          </div>
        </div>
      </div>

      {/* Desktop layout */}
      <div className="hidden xl:flex">
        <div className="flex flex-col container mx-auto">
          <div className="flex-1 sm:p-8 p-4">
            <div className="max-w-3xl mx-auto">
              <Header
                isAuthenticated={isAuthenticated}
                onLogout={handleLogout}
              />
            </div>
            <div
              className="overflow-wrap relative grid h-[calc(100vh-12rem)] max-h-[69rem] w-full gap-8 rounded-2xl xl:grid-cols-4 bg-gradient-to-r from-400/50 to-500 text-white/70 grid-cols-1 grid-rows-6 xl:grid-rows-1"
              id="demo"
            >
              <div className="contents z-50">
                <Chat
                  isOpen={isChatOpen}
                  onClose={() => toggleChat(false)}
                  onLogout={handleLogout}
                />
              </div>
              <TerminalAnimation onChatClick={() => toggleChat(!isChatOpen)} />
            </div>
            <div className="max-w-3xl mx-auto pt-12">
              <Home onChatClick={() => toggleChat(true)} />
            </div>
          </div>
        </div>
      </div>

      <div className="xl:hidden">
        <Chat
          isMobile
          isOpen={isChatOpen}
          onClose={() => toggleChat(false)}
          onLogout={handleLogout}
        />
      </div>
    </div>
  );
}
