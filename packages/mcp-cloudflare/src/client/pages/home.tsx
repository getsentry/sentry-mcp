import SKILL_DEFINITIONS from "@sentry/mcp-server/skillDefinitions";
import { Link } from "../components/ui/base";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import Note from "../components/ui/note";
import { Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import Section from "../components/ui/section";
import { Prose } from "../components/ui/prose";

interface HomeProps {
  onChatClick: () => void;
}

export default function Home({ onChatClick }: HomeProps) {
  return (
    <main className="flex gap-4 relative">
      <article className="max-w-full overflow-x-clip">
        <div id="top" />
        <Section className="space-y-4 mb-10">
          <Prose>
            <p>
              This service implements the Model Context Protocol (MCP) for
              interacting with <a href="https://sentry.io/welcome/">Sentry</a>,
              focused on human-in-the-loop coding agents and developer workflows
              rather than general-purpose API access.
            </p>
          </Prose>

          {/* Big Call to Action - Mobile Only */}
          <div className="md:hidden relative overflow-hidden bg-slate-950 p-8 text-center">
            <div className="absolute inset-0 bg-slate-950" />
            <div className="relative z-10">
              <p className="text-slate-300 mb-6 max-w-lg mx-auto">
                Chat with your stack traces. Argue with confidence. Lose
                gracefully.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Button
                  onClick={onChatClick}
                  variant="default"
                  className="gap-2 cursor-pointer"
                >
                  <Sparkles className="h-5 w-5" />
                  Try It Out
                </Button>
                <p className="text-sm text-slate-400">
                  Ask: "What are my recent issues?"
                </p>
              </div>
            </div>
          </div>

          <Prose>
            <p>
              This project is still in its infancy as development of the MCP
              specification is ongoing. If you find any problems, or have an
              idea for how we can improve it, please let us know on{" "}
              <Link href="https://github.com/getsentry/sentry-mcp/issues">
                GitHub
              </Link>
            </p>
            <h3>Interested in learning more?</h3>
            <ul>
              <li>
                <Link href="https://www.youtube.com/watch?v=n4v0fR6mVTU">
                  Using Sentry's Seer via MCP
                </Link>
              </li>
              <li>
                <Link href="https://www.youtube.com/watch?v=m3IE6JygT1o">
                  Building Sentry's MCP on Cloudflare
                </Link>
              </li>
            </ul>
          </Prose>
        </Section>

        <Section heading="Available Skills" id="skills">
          <Prose>
            <p>
              Skills are pre-configured functions that can be used to help with
              common tasks.
            </p>
          </Prose>
          <Note>
            <strong>Note:</strong> Any tool that takes an{" "}
            <code>organization_slug</code> parameter will try to infer a default
            organization, otherwise you should mention it in the prompt.
          </Note>
          <Accordion type="single" collapsible className="w-full space-y-1">
            {SKILL_DEFINITIONS.map((skill) => (
              <AccordionItem value={skill.id} key={skill.id}>
                <AccordionTrigger className="text-base text-white hover:text-violet-300 hover:no-underline cursor-pointer">
                  <div className="flex items-center justify-between w-full pr-4">
                    <span>{skill.name}</span>
                    {skill.tools && skill.tools.length > 0 && (
                      <span className="text-sm text-slate-400 font-normal">
                        {skill.tools.length}{" "}
                        {skill.tools.length === 1 ? "tool" : "tools"}
                      </span>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="py-4">
                  <Prose>
                    <p className="mb-4">{skill.description}</p>
                  </Prose>
                  {skill.tools && skill.tools.length > 0 && (
                    <div className="mt-6 space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <h4 className="text-base font-semibold text-slate-200">
                          Included Tools
                        </h4>
                        <span className="text-sm text-slate-400">
                          ({skill.tools.length}{" "}
                          {skill.tools.length === 1 ? "tool" : "tools"})
                        </span>
                      </div>
                      <div className="space-y-3">
                        {skill.tools.map((tool) => (
                          <div
                            key={tool.name}
                            className="rounded-md border border-slate-700/60 bg-black/30 p-4 hover:border-slate-600/60 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <code className="text-base font-mono font-semibold text-violet-300">
                                {tool.name}
                              </code>
                              {tool.requiredScopes &&
                                tool.requiredScopes.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {tool.requiredScopes.map((scope) => (
                                      <span
                                        key={scope}
                                        className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs font-mono text-violet-200"
                                      >
                                        {scope}
                                      </span>
                                    ))}
                                  </div>
                                )}
                            </div>
                            <p className="text-sm text-slate-300">
                              {tool.description.split("\n")[0]}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>

        <Section heading="More Information" id="more-information">
          <Prose>
            <ul>
              <li>
                <Link href="https://github.com/getsentry/sentry-mcp">
                  sentry-mcp on GitHub
                </Link>
              </li>
            </ul>
          </Prose>
        </Section>
      </article>
    </main>
  );
}
