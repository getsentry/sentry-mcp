import { TOOL_DEFINITIONS } from "@sentry/mcp-server/toolDefinitions";
import { RESOURCES } from "@sentry/mcp-server/resources";
import { PROMPT_DEFINITIONS } from "@sentry/mcp-server/promptDefinitions";
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
import RemoteSetup from "../components/fragments/remote-setup";
import { useState } from "react";
import StdioSetup from "../components/fragments/stdio-setup";
import Section from "../components/ui/section";
import { Prose } from "../components/ui/prose";

interface HomeProps {
  onChatClick: () => void;
}

export default function Home({ onChatClick }: HomeProps) {
  const [stdio, setStdio] = useState(false);

  return (
    <main className="flex gap-4 max-w-3xl">
      <article>
        <div id="top" />
        <Section className="space-y-4 mb-10">
          <Prose>
            <p>
              This service implements the Model Context Protocol (MCP) for
              interacting with <a href="https://sentry.io/welcome/">Sentry</a>.
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

          <Section heading="What is a Model Context Protocol?">
            <Prose>
              <p>
                Simply put, it's a way to plug Sentry's API into an LLM, letting
                you ask questions about your data in context of the LLM itself.
                This lets you take an agent that you already use, like Cursor,
                and pull in additional information from Sentry to help with
                tasks like debugging, code generation, and more.
              </p>
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

          <Section
            heading={
              <>
                <div className="flex-1">Getting Started</div>
                <div className="flex self-justify-end items-center gap-1 text-xs">
                  <Button
                    variant="link"
                    size="xs"
                    onClick={() => setStdio(false)}
                    active={!stdio}
                  >
                    Remote
                  </Button>
                  <span>/</span>
                  <Button
                    variant="link"
                    size="xs"
                    onClick={() => setStdio(true)}
                    active={stdio}
                  >
                    Stdio
                  </Button>
                </div>
              </>
            }
          >
            {stdio ? <StdioSetup /> : <RemoteSetup />}
          </Section>
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
                    {tool.paramsSchema ? (
                      <dl className="space-y-3 mt-6">
                        {Object.entries(tool.paramsSchema).map(
                          ([key, value]) => {
                            return (
                              <div className="p-3 bg-black/30" key={key}>
                                <dt className="text-sm font-medium text-violet-300">
                                  {key}
                                </dt>
                                <dd className="text-sm text-slate-300 mt-1">
                                  {value.description}
                                </dd>
                              </div>
                            );
                          },
                        )}
                      </dl>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              ),
            )}
          </Accordion>
        </Section>

        <Section heading="Available Prompts" id="prompts">
          <Prose>
            <p>
              Prompts are pre-configured workflows that can be used to help with
              common tasks.
            </p>
          </Prose>
          <Accordion type="single" collapsible className="w-full space-y-1">
            {PROMPT_DEFINITIONS.sort((a, b) =>
              a.name.localeCompare(b.name),
            ).map((prompt) => (
              <AccordionItem value={prompt.name} key={prompt.name}>
                <AccordionTrigger className="text-base text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                  {prompt.name}
                </AccordionTrigger>
                <AccordionContent className="max-w-none py-4">
                  <Prose>
                    <p className="mb-0">{prompt.description.split("\n")[0]}</p>
                  </Prose>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>

        <Section heading="Available Resources" id="resources">
          <Prose>
            <p>
              Generally speaking, resources that are made available can also be
              found{" "}
              <a href="https://github.com/getsentry/sentry-ai-rules">
                on GitHub in the sentry-ai-rules repository
              </a>
              .
            </p>
          </Prose>
          <Accordion type="single" collapsible className="w-full space-y-1">
            {RESOURCES.sort((a, b) => a.name.localeCompare(b.name)).map(
              (resource) => (
                <AccordionItem value={resource.name} key={resource.name}>
                  <AccordionTrigger className="text-base text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                    {resource.name}
                  </AccordionTrigger>
                  <AccordionContent className="max-w-none py-4">
                    <Prose>
                      <p className="mb-0">
                        {resource.description.split("\n")[0]}
                      </p>
                    </Prose>
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
