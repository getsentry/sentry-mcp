import { useSearchParams } from "react-router-dom";
import { Chat } from "./components/chat";
import { useAuth } from "./contexts/auth-context";

import { Header } from "./components/ui/header";
import { HeaderDivider } from "./components/hero/header-divider";
import { Sidebars } from "./components/home-layout/sidebars";

import HeroBlock from "./components/hero/hero-block";
import UseCases from "./components/usecases";
import GettingStarted from "./components/getting-started";

import Footer from "./components/home-layout/footer";

export default function App() {
  const { handleLogout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive chat state from URL - if ?chat param exists and isn't "0", chat is open
  const isChatOpen = searchParams.has("chat")
    ? searchParams.get("chat") !== "0"
    : false;

  const toggleChat = (open: boolean) => {
    const newParams = new URLSearchParams(searchParams);
    if (open) {
      newParams.set("chat", "1");
    } else {
      newParams.delete("chat");
    }
    setSearchParams(newParams);
  };

  return (
    <div
      className="overflow-x-clip max-w-screen relative w-full"
      style={
        {
          "container-type": "inline-size",
          "--scrollbar-width": "calc(100vw - 100cqw)",
        } as React.CSSProperties
      }
    >
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
