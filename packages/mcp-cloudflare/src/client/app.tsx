import { Header } from "./components/ui/header";
import { useState, useEffect } from "react";
import { Chat } from "./components/chat";
import Home from "./pages/home";

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(() => {
    // Initialize based on URL query string
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has("chat");
  });

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
      setIsChatOpen(urlParams.has("chat"));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <div className="sm:p-8 p-4 min-h-screen text-white flex flex-col items-center">
      <div className="max-w-3xl w-full">
        <Header />
        <Home onChatClick={() => toggleChat(true)} />
      </div>

      {/* Chat Panel Overlay */}
      <Chat isOpen={isChatOpen} onClose={() => toggleChat(false)} />
    </div>
  );
}
