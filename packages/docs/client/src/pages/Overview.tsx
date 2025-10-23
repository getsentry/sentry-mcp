import { Prose } from "../components/ui/prose";

export default function Overview() {
  return (
    <main className="max-w-[1200px] mx-auto px-4">
      <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-6 pt-6">
        <aside className="hidden md:block border-r border-slate-800 pr-4">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">
            Sentry MCP Docs
          </div>
          <nav className="grid gap-1 text-slate-300">
            <a href="/docs" className="rounded px-2 py-1 bg-slate-800/40">
              Overview
            </a>
            <a
              href="/docs/getting-started"
              className="rounded px-2 py-1 hover:bg-slate-800/40"
            >
              Getting Started
            </a>
            <a
              href="/docs/tools"
              className="rounded px-2 py-1 hover:bg-slate-800/40"
            >
              Tools
            </a>
            <a
              href="/docs/prompts"
              className="rounded px-2 py-1 hover:bg-slate-800/40"
            >
              Prompts
            </a>
            <a
              href="/docs/resources"
              className="rounded px-2 py-1 hover:bg-slate-800/40"
            >
              Resources
            </a>
            <a
              href="/docs/more"
              className="rounded px-2 py-1 hover:bg-slate-800/40"
            >
              More
            </a>
          </nav>
        </aside>
        <article className="pb-10">
          <Prose>
            <h1>Sentry MCP</h1>
            <p>
              This service implements the Model Context Protocol (MCP) for
              interacting with
              <a href="https://sentry.io/welcome/"> Sentry</a>, focused on
              human-in-the-loop coding agents and developer workflows.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <a
                className="block border border-slate-800 rounded p-3 hover:bg-slate-900"
                href="/docs/getting-started"
              >
                Getting Started
              </a>
              <a
                className="block border border-slate-800 rounded p-3 hover:bg-slate-900"
                href="/docs/tools"
              >
                Available Tools
              </a>
              <a
                className="block border border-slate-800 rounded p-3 hover:bg-slate-900"
                href="/docs/prompts"
              >
                Available Prompts
              </a>
              <a
                className="block border border-slate-800 rounded p-3 hover:bg-slate-900"
                href="/docs/resources"
              >
                Available Resources
              </a>
            </div>
            <h2>What is a Model Context Protocol?</h2>
            <p>
              In short, it plugs Sentry's API into an LLM so you can ask
              questions about your data within the model's context — helping
              with debugging, production issues, and understanding app behavior.
            </p>
          </Prose>
        </article>
      </div>
    </main>
  );
}
