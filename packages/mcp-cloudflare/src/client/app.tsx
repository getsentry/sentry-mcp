import { Header } from "./components/ui/header";
import { useState, useEffect } from "react";
import { Chat } from "./components/chat";
import { useAuth } from "./contexts/auth-context";
import Home from "./pages/home";
import BackgroundDecorations from "./components/animation/BackgroundDecorations";
import { HeaderDivider } from "./components/hero/header-divider";
import { Sidebars } from "./components/home-layout/sidebars";
import Footer from "./components/home-layout/footer";
import TableOfContents from "./components/docs/toc";
import HeroBlock from "./components/hero/hero-block";
// import Ghost from "./components/ghost";

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
    <div className="overflow-x-clip max-w-screen relative">
      <BackgroundDecorations />
      <Sidebars isChatOpen={isChatOpen} toggleChat={toggleChat} />
      {/* <Ghost /> */}

      <Header toggleChat={toggleChat} isChatOpen={isChatOpen} />
      <HeaderDivider />
      <HeroBlock />

      {/* main content */}
      <div className="relative container mx-auto">
        <aside className="max-xl:hidden absolute h-full right-15 inset-y-0">
          <TableOfContents />
        </aside>
        <main
          className={`max-w-3xl px-4 sm:px-8 xl:max-w-1/2 mx-auto motion-safe:duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
            isChatOpen ? "xl:-translate-x-1/2" : ""
          }`}
        >
          <Home onChatClick={() => toggleChat(true)} />
        </main>
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
