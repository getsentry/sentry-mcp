import TOOL_DEFINITIONS from "@sentry/mcp-server/toolDefinitions";
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
import { useState } from "react";
import Section from "../components/ui/section";
import { Prose } from "../components/ui/prose";
import JsonSchemaParams from "../components/ui/json-schema-params";

interface HomeProps {
  onChatClick: () => void;
}

export default function Home({ onChatClick }: HomeProps) {
  const [stdio, setStdio] = useState(false);

  return (
    <main className="flex gap-4 relative">
      <aside className="max-xl:hidden absolute h-full right-0 inset-y-0 translate-x-[150%]">
        {/* <TableOfContents /> */}
      </aside>
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

          <Section>
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

          {/* <Section
            id="getting-started"
            heading={
              <>
                <div className="flex-1">Getting Started</div>
                <div className="flex items-center gap-2 text-xs">
                  <Button
                    variant={!stdio ? "default" : "secondary"}
                    size="xs"
                    onClick={() => setStdio(false)}
                    className={!stdio ? "shadow-sm" : undefined}
                  >
                    Cloud
                  </Button>
                  <Button
                    variant={stdio ? "default" : "secondary"}
                    size="xs"
                    onClick={() => setStdio(true)}
                    className={stdio ? "shadow-sm" : undefined}
                  >
                    Stdio
                  </Button>
                </div>
              </>
            }
          >
            <div className="relative min-h-0">
              {!stdio ? (
                <div
                  key="cloud"
                  className="animate-in fade-in motion-safe:slide-in-from-left-4 duration-300"
                >
                  <RemoteSetup />
                </div>
              ) : (
                <div
                  key="stdio-self-hosted"
                  className="animate-in fade-in motion-safe:slide-in-from-right-4 duration-300"
                >
                  <StdioSetup />
                </div>
              )}
            </div>
          </Section> */}
        </Section>

        <Section heading="Available Tools" id="tools">
          <Prose>
            <p>
              Tools are pre-configured functions that can be used to help with
              common tasks.
            </p>
          </Prose>
          <Note>
            <strong>Note:</strong> Any tool that takes an{" "}
            <code>organization_slug</code> parameter will try to infer a default
            organization, otherwise you should mention it in the prompt.
          </Note>
          <Accordion type="single" collapsible className="w-full space-y-1">
            {TOOL_DEFINITIONS.sort((a, b) => a.name.localeCompare(b.name)).map(
              (tool) => (
                <AccordionItem value={tool.name} key={tool.name}>
                  <AccordionTrigger className="text-base text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                    {tool.name}
                  </AccordionTrigger>
                  <AccordionContent className="py-4">
                    <Prose>
                      <p className="mb-0">{tool.description.split("\n")[0]}</p>
                    </Prose>
                    <div className="mt-4 space-y-4">
                      {/* Authorization / Scopes */}
                      <section className="rounded-md border border-slate-700/60 bg-black/30 p-3">
                        <div className="text-xs uppercase tracking-wide text-slate-300/80 mb-2">
                          Authorization
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {tool.requiredScopes &&
                          tool.requiredScopes.length > 0 ? (
                            tool.requiredScopes.map((s) => (
                              <span
                                key={s}
                                className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs font-mono text-violet-200"
                              >
                                {s}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-400">None</span>
                          )}
                        </div>
                      </section>
                      <JsonSchemaParams schema={tool.inputSchema as unknown} />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ),
            )}
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
