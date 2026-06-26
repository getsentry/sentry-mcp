import { SearchX } from "lucide-react";
import ErrorListWithCursorFollower from "./search-visual";

export default function SearchThings() {
  return (
    <div className="p-4 sm:p-8 overflow-hidden justify-end flex flex-col group relative border-b border-dashed border-white/10">
      <div className="absolute inset-0 bg-squares [--size:1rem] [mask-image:linear-gradient(to_bottom,red,transparent,red)] group-hover:opacity-50 opacity-30 duration-300 -z-20 text-white" />
      <ErrorListWithCursorFollower />
      <div className="flex">
        <div className="flex flex-col">
          <h3 className="md:text-xl font-bold">Search Things</h3>
          <p className="text-balance text-white/70">
            Because “I swear it worked locally” isn&apos;t observability. Find
            anything, anywhere, instantly.
          </p>
        </div>
        <SearchX className="size-16 ml-auto text-white/20 group-hover:text-white/40 stroke-[0.5px] duration-300 mt-auto" />
      </div>
    </div>
  );
}
