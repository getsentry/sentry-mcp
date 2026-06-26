import FixBugs from "./fix-bugs";
import Instrument from "./instrument";
import SearchThings from "./search-things";

export default function UseCases() {
  return (
    <section className="scroll-mt-20 flex flex-col xl:max-w-xl relative">
      <FixBugs />
      <Instrument />
      <SearchThings />
    </section>
  );
}
