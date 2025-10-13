import { Header } from "./components/ui/header";
import { useState, useEffect } from "react";
import { Chat } from "./components/chat";
import { useAuth } from "./contexts/auth-context";
import Home from "./pages/home";
import TerminalAnimation from "./components/animation/TerminalAnimation";
import BackgroundDecorations from "./components/animation/BackgroundDecorations";
import { Button } from "./components/ui/button";
import CodeSnippet from "./components/ui/code-snippet";
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

  const endpoint = new URL("/mcp", window.location.href).href;

  return (
    <div className="min-h-screen overflow-x-clip max-w-screen relative text-white">
      <BackgroundDecorations />
      {/* <Ghost /> */}

      <Header toggleChat={toggleChat} isChatOpen={isChatOpen} />
      {/* header divider */}
      <div className="sticky top-17 z-30 sm:-mb-64 sm:mt-64 md:-mb-58 md:mt-58 xl:-mb-44 xl:mt-44 2xl:-mb-38 2xl:mt-38 w-screen border-b-[1px] border-violet-300/20">
        <div className="absolute top-0 left-0 sm:left-[calc((100vw-40rem)/2)] md:left-[calc((100vw-48rem)/2)] lg:left-[calc((100vw-64rem)/2)] xl:left-[calc((100vw-80rem)/2)] 2xl:left-[calc((100vw-96rem)/2)] -translate-x-[calc(50%+0.5px)] -translate-y-1/2 h-4 w-4 border bg-white/5 backdrop-blur border-violet-300/20" />
        <div className="absolute top-0 right-0 sm:right-[calc((100vw-40rem)/2)] md:right-[calc((100vw-48rem)/2)] lg:right-[calc((100vw-64rem)/2)] xl:right-[calc((100vw-80rem)/2)] 2xl:right-[calc((100vw-96rem)/2)] translate-x-[calc(50%+0.5px)] -translate-y-1/2 h-4 w-4 border bg-white/5 backdrop-blur border-violet-300/20" />
      </div>
      <div className="flex-1 flex flex-col container mx-auto max-h-[69rem] min-h-[calc(100svh-69px)]">
        <div className="grid xl:grid-cols-2 gap-8 sm:px-8 sm:py-6 px-4 py-3">
          <p className="text-white/70 max-w-[69ch] max-sm:hidden">
            Simply put, it's a way to plug Sentry's API into an LLM, letting you
            ask questions about your data in context of the LLM itself. This
            lets you take a coding agent that you already use, like Cursor or
            Claude Code, and pull in additional information from Sentry to help
            with tasks like debugging, fixing production errors, and
            understanding your application's behavior.
          </p>
          <div className="flex h-full items-center xl:justify-end gap-6 flex-wrap">
            <CodeSnippet noMargin snippet={endpoint} />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const deepLink =
                  "cursor://anysphere.cursor-deeplink/mcp/install?name=Sentry&config=eyJ1cmwiOiJodHRwczovL21jcC5zZW50cnkuZGV2L21jcCJ9";
                window.location.href = deepLink;
              }}
              className="mt-2 mb-2 bg-violet-300 text-black hover:bg-violet-400 hover:text-black"
            >
              Install in Cursor
            </Button>
          </div>
        </div>
        {/* demo */}
        <div
          className="overflow-wrap p-4 sm:p-8 overflow-visible relative grid h-full flex-1 w-full gap-8 rounded-2xl xl:grid-cols-4 bg-gradient-to-r from-400/50 to-500 text-white/70 grid-cols-1 grid-rows-6 xl:grid-rows-1"
          id="demo"
        >
          <TerminalAnimation />
        </div>
      </div>
      <div className="container mx-auto">
        <div
          className={`max-w-3xl px-4 sm:px-8 xl:max-w-[calc(50%-2rem)] mx-auto duration-300 ${
            isChatOpen ? "xl:-translate-x-[calc(50%+2rem)]" : ""
          }`}
        >
          <Home onChatClick={() => toggleChat(true)} />
        </div>
      </div>
      {/* footer */}
      <div className="group inset-x-0 bottom-14 bg-[#201633] w-full h-32 bg-fixed z-10 border-t opacity-50 bg-clip-padding border-white/20 grid place-items-center font-mono">
        footer
      </div>
      <div className="group inset-x-0 bottom-0 bg-[#201633] w-full h-14 bg-fixed bg-[repeating-linear-gradient(45deg,#fff2,#fff2_1px,#fff0_1.5px,#fff0_12px)] z-10 border-t opacity-50 bg-clip-padding border-white/20" />

      {/* aside */}
      <div className="group hidden sm:block fixed left-0 inset-y-0 h-full sm:w-[calc((100vw-40rem)/2)] md:w-[calc((100vw-48rem)/2)] lg:w-[calc((100vw-64rem)/2)] xl:w-[calc((100vw-80rem)/2)] 2xl:w-[calc((100vw-96rem)/2)] bg-fixed bg-[repeating-linear-gradient(-45deg,#fff2,#fff2_1px,#fff0_1.5px,#fff0_12px)] z-10 border-r opacity-50 bg-clip-padding border-white/20" />

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: <leave as-is for now for the sidebar> */}
      <div
        className={`group hidden sm:grid fixed right-0 inset-y-0 h-full w-[50vw] duration-300 cursor-pointer place-items-center z-40 border-l ${
          isChatOpen
            ? "bg-[#201633] translate-x-0 opacity-100 border-white/10"
            : "sm:translate-x-[20rem] md:translate-x-[24rem] lg:translate-x-[32rem] xl:translate-x-[40rem] 2xl:translate-x-[48rem] opacity-50 hover:bg-[#201633] bg-clip-padding border-white/20 bg-[repeating-linear-gradient(-45deg,#fff2,#fff2_1px,#fff0_1.5px,#fff0_12px)]"
        }`}
        onClick={() => toggleChat(true)}
      >
        {!isChatOpen && (
          <div className="font-mono absolute xl:w-12 min-[1800px]:w-fit min-[1800px]:text-nowrap text-center flex justify-center xl:left-[calc((100vw-80rem)/4)] 2xl:left-[calc((100vw-96rem)/4)] top-1/2 -translate-1/2 opacity-0 group-hover:opacity-100 duration-300 bg-[#201633] px-1">
            Open Chat
          </div>
        )}
      </div>
      <Chat
        isOpen={isChatOpen}
        onClose={() => toggleChat(false)}
        onLogout={handleLogout}
      />
    </div>
  );
}
