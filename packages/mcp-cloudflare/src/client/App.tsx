import { TOOL_DEFINITIONS } from "@sentry/mcp-server/toolDefinitions";
import { RESOURCES } from "@sentry/mcp-server/resources";
import { PROMPT_DEFINITIONS } from "@sentry/mcp-server/promptDefinitions";
import { Paragraph, Heading, Link } from "./components/ui/base";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import Note from "./components/ui/note";
import { ChevronRight } from "lucide-react";
import CodeSnippet from "./components/ui/code-snippet";
import { Header } from "./components/ui/header";

const mcpServerName = import.meta.env.DEV ? "sentry-dev" : "sentry";

function SetupGuide({
  id,
  title,
  children,
}: { id: string; title: string; children: React.ReactNode }) {
  return (
    <AccordionItem
      value={id}
      className="last:border-b border px-4 border-gray-800"
    >
      <AccordionTrigger className="text-lg text-white hover:text-violet-300 cursor-pointer">
        {title}
      </AccordionTrigger>
      <AccordionContent className="text-gray-300 prose prose-invert">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

export default function App() {
  const sseUrl = new URL("/sse", window.location.href).href;
  const mcpRemoteSnippet = `npx mcp-remote ${sseUrl}`;

  // https://code.visualstudio.com/docs/copilot/chat/mcp-servers
  const vsCodeHandler = `code:mcp/install?${encodeURIComponent(
    JSON.stringify({
      name: mcpServerName,
      command: "npx",
      args: ["-y", "mcp-remote", sseUrl],
    }),
  )}`;
  const zedInstructions = JSON.stringify(
    {
      context_servers: {
        [mcpServerName]: {
          command: "npx",
          args: ["-y", "mcp-remote", sseUrl],
        },
        settings: {},
      },
    },
    undefined,
    2,
  );

  return (
    <div className="sm:p-8 p-4 min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white text-lg flex flex-col items-center">
      <div className="max-w-3xl w-full">
        <Header />
        <main className="flex gap-4 max-w-3xl">
          <article>
            <div id="top" />
            <section className="space-y-4 mb-6">
              <Paragraph>
                This service provides a Model Context Provider (MCP) for
                interacting with{" "}
                <a href="https://docs.sentry.io/api/">Sentry's API</a>.
              </Paragraph>
              <Paragraph>
                What is a Model Context Provider? Simply put, its a way to plug
                Sentry's API into an LLM, letting you ask questions about your
                data in the a local context to the LLM itself. This lets you
                take an agent that you already use, like Cursor, and pull in
                context from Sentry to help with tasks like debugging, code
                generation, and more.
              </Paragraph>
              <Paragraph>
                For an example, this showcases using Cursor to help with
                debugging an issue using Sentry's Seer functionality:
              </Paragraph>
              <iframe
                width="560"
                height="315"
                src="https://www.youtube.com/embed/n4v0fR6mVTU?si=R-TtWXbVugTTZfOH"
                title="YouTube video player"
                className="border border-gray-800 mb-6"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
              <Note>
                <strong>Note:</strong> While this service is maintained by
                Sentry, it is very much still a proof-of-concept as the protocol
                is still in development (as is our own thinking around its
                usage).
              </Note>
            </section>

            <section className="space-y-4 mb-6">
              <Heading>Getting Started</Heading>
              <Paragraph>
                If you've got a client that natively supports the current MCP
                specification, including OAuth, you can connect directly.
              </Paragraph>
              <CodeSnippet snippet={sseUrl} />
              <Paragraph>
                Otherwise, you can use the following setup guides to get
                started.
              </Paragraph>
              <Heading as="h4" className="text-xl">
                Setup Guides
              </Heading>
              <Accordion type="single" collapsible className="w-full">
                <SetupGuide id="cursor" title="Cursor">
                  <ol>
                    <li>
                      <strong>Cmd + Shift + J</strong> to open Cursor Settings.
                    </li>
                    <li>
                      Select <strong>MCP</strong>.
                    </li>
                    <li>
                      Select <strong>Add new global MCP server</strong>.
                    </li>
                  </ol>
                </SetupGuide>

                <SetupGuide id="windsurf" title="Windsurf">
                  <ol>
                    <li>Open Windsurf Settings.</li>
                    <li>
                      Under <strong>Cascade</strong>, you'll find{" "}
                      <strong>Model Context Provider Servers</strong>.
                    </li>
                    <li>
                      Select <strong>Add Server</strong>.
                    </li>
                  </ol>
                  <p>
                    <small>
                      Note: Windsurf requires an enterprise account to utilize
                      MCP. 😕
                    </small>
                  </p>
                </SetupGuide>

                <SetupGuide id="vscode" title="Visual Studio Code">
                  <ol>
                    <li>
                      <a href={vsCodeHandler}>Install the MCP extension</a>
                    </li>
                  </ol>
                  <p>
                    If this doesn't work, you can manually add the server using
                    the following steps:
                  </p>
                  <ol>
                    <li>
                      <strong>CMD + P</strong> and search for{" "}
                      <strong>MCP: Add Server</strong>.
                    </li>
                    <li>
                      Select <strong>Command (stdio)</strong>
                    </li>
                    <li>
                      Enter the following configuration, and hit enter.
                      <div className="snippet">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(zedInstructions);
                          }}
                        >
                          Copy
                        </button>
                        <pre>{mcpRemoteSnippet}</pre>
                      </div>
                    </li>
                    <li>
                      Enter the name <strong>Sentry</strong> and hit enter.
                    </li>
                    <li>
                      Activate the server using{" "}
                      <strong>MCP: List Servers</strong> and selecting{" "}
                      <strong>Sentry</strong>, and selecting{" "}
                      <strong>Start Server</strong>.
                    </li>
                  </ol>
                  <p>
                    <small>
                      Note: MCP is supported in VSCode 1.99 and above.
                    </small>
                  </p>
                </SetupGuide>

                <SetupGuide id="zed" title="Zed">
                  <ol>
                    <li>
                      <strong>CMD + ,</strong> to open Zed settings.
                    </li>
                    <li>
                      <div className="snippet">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(zedInstructions);
                          }}
                        >
                          Copy
                        </button>
                        <pre>{zedInstructions}</pre>
                      </div>
                    </li>
                  </ol>
                </SetupGuide>
              </Accordion>
            </section>

            <section className="space-y-4 mb-6" id="workflows">
              <Heading>Workflows</Heading>
              <Paragraph>
                Here's a few sample workflows (prompts) that we've tried to
                design around within the provider:
              </Paragraph>
              <ul className="space-y-4 text-base">
                {[
                  "Check Sentry for errors in file.tsx and propose solutions.",
                  "Diagnose issue ISSUE_URL and propose solutions.",
                  "Create a new project in Sentry for service-name and setup local instrumentation using it.",
                  "Use Sentry's autofix feature, and help me analyze and propose a solution for ISSUE_URL.",
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
            </section>

            <section id="tools" className="space-y-4 mb-6">
              <Heading>Available Tools</Heading>
              <Paragraph>
                Tools are pre-configured functions that can be used to help with
                common tasks.
              </Paragraph>
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
                    <AccordionTrigger className="text-lg text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                      {tool.name}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-300">
                      <Paragraph className="mb-0">
                        {tool.description.split("\n")[0]}
                      </Paragraph>
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
            </section>

            <section id="prompts" className="space-y-4 mb-6">
              <Heading>Available Prompts</Heading>
              <Paragraph>
                Prompts are pre-configured workflows that can be used to help
                with common tasks.
              </Paragraph>
              <Accordion type="single" collapsible className="w-full space-y-4">
                {PROMPT_DEFINITIONS.map((prompt) => (
                  <AccordionItem
                    value={prompt.name}
                    key={prompt.name}
                    className="border last:border-b px-4 border-gray-800"
                  >
                    <AccordionTrigger className="text-lg text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                      {prompt.name}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-300 prose prose-invert">
                      <Paragraph className="mb-0">
                        {prompt.description.split("\n")[0]}
                      </Paragraph>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>

            <section id="resources" className="space-y-4 mb-6">
              <Heading>Available Resources</Heading>
              <Paragraph>
                Generally speaking, resources that are made available can also
                be found{" "}
                <Link href="https://github.com/getsentry/sentry-ai-rules">
                  on GitHub in the sentry-ai-rules repository
                </Link>
                .
              </Paragraph>
              <Accordion type="single" collapsible className="w-full space-y-4">
                {RESOURCES.map((resource) => (
                  <AccordionItem
                    value={resource.name}
                    key={resource.name}
                    className="border last:border-b px-4 border-gray-800"
                  >
                    <AccordionTrigger className="text-lg text-white hover:text-violet-300 cursor-pointer font-mono font-semibold">
                      {resource.name}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-300 prose prose-invert">
                      <Paragraph className="mb-0">
                        {resource.description.split("\n")[0]}
                      </Paragraph>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>

            <section id="more-information" className="space-y-4 mb-6">
              <Heading>More Information</Heading>
              <ul className="list-disc list-inside">
                <li>
                  <Link href="https://github.com/getsentry/sentry-mcp">
                    sentry-mcp on GitHub
                  </Link>
                </li>
              </ul>
            </section>
          </article>
        </main>
      </div>
    </div>
  );
}
