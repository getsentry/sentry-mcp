import FixBugs from "./fix-bugs";
import Instrument from "./instrument";
import SearchThings from "./search-things";

export default function UseCases() {
  return (
    <section className="scroll-mt-20 flex flex-col max-xl:lg:grid max-xl:lg:grid-cols-3 xl:max-w-xl relative">
      <FixBugs />
      <Instrument />
      <SearchThings />
    </section>
  );
}
