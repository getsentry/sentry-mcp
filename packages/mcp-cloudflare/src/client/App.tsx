import { TOOL_DEFINITIONS } from "@sentry/mcp-server/toolDefinitions";
import { RESOURCES } from "@sentry/mcp-server/resources";
import { PROMPT_DEFINITIONS } from "@sentry/mcp-server/promptDefinitions";
import { Heading, Link } from "./components/ui/base";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import Note from "./components/ui/note";
import { ChevronRight } from "lucide-react";
import { Header } from "./components/ui/header";
import flowImage from "./flow.png";
import { Button } from "./components/ui/button";
import RemoteSetup from "./components/fragments/remote-setup";
import { useState } from "react";
import StdioSetup from "./components/fragments/stdio-setup";
import Section from "./components/ui/section";
import { Prose } from "./components/ui/prose";

export default function App() {
  const [stdio, setStdio] = useState(false);

  return (
    <div className="sm:p-8 p-4 min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white flex flex-col items-center">
      <div className="max-w-3xl w-full">
        <Header />
        <main className="flex gap-4 max-w-3xl">
          <article>
            <div id="top" />
            <Section className="space-y-4 mb-10">
              <Prose>
                <p>
                  This service provides a Model Context Provider (MCP) for
                  interacting with{" "}
                  <a href="https://docs.sentry.io/api/">Sentry's API</a>.
                </p>
                <blockquote>
                  <p>
                    MCP is pretty sweet. Cloudflare's support of MCP is pretty
                    sweet. Sentry is pretty sweet. So we made an MCP for Sentry
                    on top of Cloudflare.
                  </p>
                  <cite>David Cramer, Sentry</cite>
                </blockquote>
                <h3>What is a Model Context Provider?</h3>
                <p>
                  Simply put, its a way to plug Sentry's API into an LLM,
                  letting you ask questions about your data in context of the
                  LLM itself. This lets you take an agent that you already use,
                  like Cursor, and pull in additional information from Sentry to
                  help with tasks like debugging, code generation, and more.
                </p>
                <img src={flowImage} alt="Flow" className="w-full mb-6" />
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
                  <div className="flex self-justify-end items-center gap-1 text-xs text-neutral-600">
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

            <Section heading="Workflows" id="workflows">
              <Prose>
                <p>
                  Here's a few sample workflows (prompts) that we've tried to
                  design around within the provider:
                </p>
              </Prose>
              <ul className="space-y-4 text-base">
                {[
                  "Check Sentry for errors in file.tsx and propose solutions.",
                  "Diagnose issue ISSUE_URL and propose solutions.",
                  "What are my latest issues in ORG/PROJECT?",
                  "Create a new project in Sentry for PROJECT and setup local instrumentation using it.",
                  "Use Sentry's Seer and help me analyze and propose a solution for ISSUE_URL.",
                ].map((prompt) => (
                  <li
                    key={prompt}
                    className="flex items-start gap-3 p-4 bg-gray-900/50 border border-gray-800"
                  >
                    <div className="mt-1 text-violet-400">
                      <ChevronRight className="h-4 w-4" />
                    </div>
                    <div className="text-gray-200">{prompt}</div>
                  </li>
                ))}
              </ul>
            </Section>

            <Section heading="Available Tools" id="tools">
              <Prose>
                <p>
                  Tools are pre-configured functions that can be used to help
                  with common tasks.
                </p>
              </Prose>
              <Note>
                <strong>Note:</strong> Any tool that takes an{" "}
                <code>organization_slug</code> parameter will try to infer a
                default organization, otherwise you should mention it in the
                prompt.
              </Note>
              <Accordion type="single" collapsible className="w-full space-y-4">
                {TOOL_DEFINITIONS.map((tool) => (
                  <AccordionItem
                    value={tool.name}
                    key={tool.name}
                    className="border last:border-b px-4 border-gray-800"
                  >
                    <AccordionTrigger className="text-base text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                      {tool.name}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-300">
                      <Prose>
                        <p className="mb-0">
                          {tool.description.split("\n")[0]}
                        </p>
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
                                  <dd className="text-sm text-gray-300 mt-1">
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
                ))}
              </Accordion>
            </Section>

            <Section heading="Available Prompts" id="prompts">
              <Prose>
                <p>
                  Prompts are pre-configured workflows that can be used to help
                  with common tasks.
                </p>
              </Prose>
              <Accordion type="single" collapsible className="w-full space-y-4">
                {PROMPT_DEFINITIONS.map((prompt) => (
                  <AccordionItem
                    value={prompt.name}
                    key={prompt.name}
                    className="border last:border-b px-4 border-gray-800"
                  >
                    <AccordionTrigger className="text-base text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                      {prompt.name}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-300 prose prose-invert max-w-none">
                      <Prose>
                        <p className="mb-0">
                          {prompt.description.split("\n")[0]}
                        </p>
                      </Prose>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Section>

            <Section heading="Available Resources" id="resources">
              <Prose>
                <p>
                  Generally speaking, resources that are made available can also
                  be found{" "}
                  <a href="https://github.com/getsentry/sentry-ai-rules">
                    on GitHub in the sentry-ai-rules repository
                  </a>
                  .
                </p>
              </Prose>
              <Accordion type="single" collapsible className="w-full space-y-4">
                {RESOURCES.map((resource) => (
                  <AccordionItem
                    value={resource.name}
                    key={resource.name}
                    className="border last:border-b px-4 border-gray-800"
                  >
                    <AccordionTrigger className="text-base text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                      {resource.name}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-300 prose prose-invert max-w-none">
                      <Prose>
                        <p className="mb-0">
                          {resource.description.split("\n")[0]}
                        </p>
                      </Prose>
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
      </div>
    </div>
  );
}
