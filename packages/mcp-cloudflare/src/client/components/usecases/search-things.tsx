import { SearchX } from "lucide-react";
import ErrorListWithCursorFollower from "./search-visual";

export default function SearchThings() {
  return (
    <div className="p-4 sm:p-8 overflow-hidden justify-end flex flex-col group relative">
      <div className="absolute inset-0 bg-grid [--size:1rem] [mask-image:linear-gradient(to_bottom,red,transparent,red)] group-hover:opacity-50 opacity-30 duration-300 -z-20" />
      <ErrorListWithCursorFollower />
      <div className="flex">
        <div className="flex flex-col">
          <h3 className="md:text-xl font-bold">Search Things</h3>
          <p className="text-balance text-white/70">
            Lorem ipsum dolor sit amet consectetur adipisicing elit.
            Perspiciatis, fugit.
          </p>
        </div>
        <SearchX className="size-16 ml-auto text-white/20 group-hover:text-white/40 stroke-[0.5px] duration-300 mt-auto" />
      </div>
    </div>
  );
}
