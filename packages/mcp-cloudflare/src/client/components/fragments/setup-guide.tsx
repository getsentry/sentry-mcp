import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";

export default function SetupGuide({
  id,
  title,
  children,
}: { id: string; title: string; children: React.ReactNode }) {
  return (
    <AccordionItem value={id}>
      <AccordionTrigger>{title}</AccordionTrigger>
      <AccordionContent className="prose prose-invert">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
