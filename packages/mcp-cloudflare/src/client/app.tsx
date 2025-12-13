import { Chat } from "./components/chat";
import { useAuth } from "./contexts/auth-context";
import { useState, useEffect } from "react";

import { Header } from "./components/ui/header";
import { HeaderDivider } from "./components/hero/header-divider";
import { Sidebars } from "./components/home-layout/sidebars";

import HeroBlock from "./components/hero/hero-block";
import UseCases from "./components/usecases";
import GettingStarted from "./components/getting-started";

import Footer from "./components/home-layout/footer";

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
        // default to closed on both desktop and mobile
        setIsChatOpen(false);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <div className="overflow-x-clip max-w-screen relative">
      {/* //!NOTE: order matters for z- */}
      <Sidebars isChatOpen={isChatOpen} toggleChat={toggleChat} />
      <Header toggleChat={toggleChat} isChatOpen={isChatOpen} />
      <HeaderDivider />

      <HeroBlock />
      <div className="flex flex-col xl:flex-row container mx-auto border-t border-dashed border-white/10">
        <UseCases />
        <div className="border-r border-dashed border-white/10" />
        <GettingStarted />
      </div>

      <Chat
        isOpen={isChatOpen}
        onClose={() => toggleChat(false)}
        onLogout={handleLogout}
      />

      <Footer isChatOpen={isChatOpen} />
    </div>
  );
}
