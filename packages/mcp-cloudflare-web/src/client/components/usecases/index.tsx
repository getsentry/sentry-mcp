import FixBugs from "./fix-bugs";
import Instrument from "./instrument";
import SearchThings from "./search-things";

export default function UseCases() {
  return (
    <section className="scroll-mt-20 grid lg:grid-cols-3 relative container mx-auto border-y border-dashed border-white/20">
      <FixBugs />
      <Instrument />
      <SearchThings />
    </section>
  );
}
