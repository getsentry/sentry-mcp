import { Grip } from "lucide-react";
import { Prose } from "../ui/prose";

export default function InstallTabs({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // <div className="mb-6 flex w-full items-center rounded-2xl bg-gradient-to-r from-purple-600/30 via-pink-600/30 to-red-600/30 p-1">
    <div className="relative bg-[#201633] rounded-2xl mb-6">
      <div className="flex">
        <div className="flex max-w-full">
          {/* <div className="absolute inset-x-1 bottom-1 rounded-xl h-17 w-full bg-[#201633]" /> */}
          {Array.from([
            "Cursor",
            "Claude Code",
            "Windsurf",
            "Visual Studio Code",
            "Warp",
            "Zed",
          ]).map((name, i) => (
            <div key={name} className="relative group/tab cursor-pointer">
              {i > 0 && (
                <>
                  <div className="group-hover/tab:scale-100 group-hover/tab:duration-200 duration-0 scale-0 absolute left-1 -translate-x-full -top-2 size-3 bg-[#201633] origin-bottom-right" />
                  <div className="group-hover/tab:scale-100 group-hover/tab:duration-200 duration-0 scale-0 absolute left-0 -translate-x-full top-0 -translate-y-full size-4 rounded-full bg-[#392f59] origin-bottom-right" />
                </>
              )}
              <div className="absolute inset-[0.5px] bottom-4 bg-orange-400 bg-dots rounded-xl z-0" />
              <div className="absolute inset-[0.5px] bottom-6 bg-pink-600 bg-grid [--size:10px] rounded-xl z-0" />
              <div className="bg-[#201633] relative group-hover/tab:-translate-y-6 rounded-xl py-4 px-6 duration-200 group-hover/tab:ease-[cubic-bezier(0.175,0.885,0.32,1.275)] perspective-distant group-hover/tab:-rotate-x-45 text-nowrap">
                {name}
              </div>
              {i < 5 && (
                <>
                  <div className="group-hover/tab:scale-100 group-hover/tab:duration-200 duration-0 scale-0 absolute right-1 translate-x-full -top-2 size-3 bg-[#201633] origin-bottom-left" />
                  <div className="group-hover/tab:scale-100 group-hover/tab:duration-200 duration-0 scale-0 absolute right-0 translate-x-full top-0 -translate-y-full size-4 rounded-full bg-[#392f59] origin-bottom-left" />
                </>
              )}
            </div>
          ))}
        </div>
        <Grip className="flex-shrink-0 ml-auto cursor-grab mr-4 mt-5 size-4 text-white/50 active:cursor-grabbing" />
      </div>
      <Prose className="p-4 pt-0">{children}</Prose>
    </div>
    // </div>
  );
}
