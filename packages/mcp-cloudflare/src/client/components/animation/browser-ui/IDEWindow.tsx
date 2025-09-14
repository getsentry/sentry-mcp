import { X } from "lucide-react";
import WindowHeader from "./WindowHeader";

export default function IDEWindow({ step }: { step: number }) {
  return (
    <div
      className={`${
        step >= 3 && step < 5
          ? "translate-x-0 scale-100 blur-none"
          : "-translate-x-32 scale-75 opacity-0 blur-xl"
      } absolute bottom-2.5 flex h-[calc(100%-0.625rem)] w-full origin-bottom flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/15 pb-1 backdrop-blur duration-300`}
      id="window2-ide"
    >
      <WindowHeader ide />
      <div className="relative h-full">
        <div className="flex border-white/10 border-t">
          {/*packages/mcp-server/src/api-client/*/}
          <div
            className={`${
              step === 4
                ? "bg-black/20 opacity-100 translate-y-0"
                : "opacity-0 translate-y-2"
            } flex items-center justify-between gap-2 truncate duration-300 border-white/10 border-r px-2 py-2`}
          >
            schema.ts
            <X className="size-4 flex-shrink-0" />
          </div>
          <div
            className={`${
              step === 4
                ? "bg-black/20 opacity-100 delay-2000 translate-y-0"
                : "opacity-0 translate-y-2"
            } flex items-center justify-between gap-2 truncate duration-300 border-white/10 border-r px-4 py-2`}
          >
            types.ts
            <X className="size-4 flex-shrink-0" />
          </div>
          {/*packages/mcp-server/src/tools/*/}
          <div
            className={`${
              step === 4
                ? "bg-black/20 opacity-100 delay-3000 translate-y-0"
                : "opacity-0 translate-y-2"
            } flex items-center justify-between gap-2 truncate duration-300 border-white/10 border-r px-4 py-2`}
          >
            get-trace-details.ts
            <X className="size-4 flex-shrink-0" />
          </div>
        </div>
        <img
          alt="cooking"
          className="mx-auto mt-12"
          height={393}
          src="https://media.tenor.com/6kWOxIkVNPwAAAAM/nails-family-guy.gif"
          width={220}
        />
        {/* <DiffBlock code={diff1} step={step} /> */}
        <pre
          className={`${
            step === 4 ? "opacity-100" : "opacity-0"
          } absolute inset-0 top-10 z-50 h-full bg-neutral-900 text-sm duration-300`}
          style={{
            transitionDelay: step === 4 ? `${3}s` : "0s",
          }}
        >
          {Array.isArray(diff1) &&
            diff1.map((line, idx) => (
              <div
                className={`${
                  step === 4
                    ? "translate-x-0 opacity-100 blur-none duration-300"
                    : "-translate-x-8 opacity-0 blur-xl"
                } ease-[cubic-bezier(0.64,0.57,0.67,1.53) ${
                  line.includes("+")
                    ? "bg-lime-300/30 text-lime-400"
                    : line.includes("-")
                      ? "bg-red-300/30 text-red-400"
                      : "text-white/70"
                }}`}
                key={line}
                style={{
                  transitionDelay: step === 4 ? `${3 + 0.05 * idx}s` : "0s",
                }}
              >
                {line}
              </div>
            ))}
        </pre>
        <pre
          className={`${
            step >= 4 ? "opacity-100" : "opacity-0"
          } absolute inset-0 top-10 z-40 h-full bg-neutral-900 text-sm delay-2000 duration-300`}
        >
          {diff2.map((line, idx) => (
            <div
              className={`${
                step >= 4
                  ? "translate-x-0 opacity-100 blur-none duration-300"
                  : "-translate-x-8 opacity-0 blur-xl"
              } ease-[cubic-bezier(0.64,0.57,0.67,1.53) ${
                line.includes("+")
                  ? "bg-lime-300/30 text-lime-400"
                  : line.includes("-")
                    ? "bg-red-300/30 text-red-400"
                    : "text-white/70"
              }}`}
              key={line}
              style={{
                transitionDelay: step >= 4 ? `${2 + 0.05 * idx}s` : "0s",
              }}
            >
              {line}
            </div>
          ))}
        </pre>
        <pre
          className={`${
            step >= 4 ? "opacity-100" : "opacity-0"
          } absolute inset-0 top-10 z-30 h-full bg-neutral-900 text-sm delay-100 duration-300`}
        >
          {diff3.map((line, idx) => (
            <div
              className={`${
                step >= 4
                  ? "translate-x-0 opacity-100 blur-none duration-300"
                  : "-translate-x-8 opacity-0 blur-xl"
              } ease-[cubic-bezier(0.64,0.57,0.67,1.53) ${
                line.includes("+")
                  ? "bg-lime-300/30 text-lime-400"
                  : line.includes("-")
                    ? "bg-red-300/30 text-red-400"
                    : "ext-white/70"
              }}`}
              key={line}
              style={{
                transitionDelay: step >= 4 ? `${0.1 + 0.05 * idx}s` : "0s",
              }}
            >
              {line}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

const diff1 = [
  "        152      const selected: SelectedSpan[] = [];",
  "        153      let spanCount = 0;",
  "        154",
  "        155 +    // Filter out non-span items (issues) from the trace data",
  "        156 +    // Spans must have children array, duration, and other span-specific fields",
  "        157 +    const actualSpans = spans.filter(item =>",
  "        158 +      item &&",
  "        159 +      typeof item === 'object' &&",
  "        160 +      'children' in item &&",
  "        161 +      Array.isArray(item.children) &&",
  "        162 +      'duration' in item",
  "        163 +    );",
  "        164 +",
  "        165      function addSpan(span: any, level: number): boolean {",
  "        166        if (spanCount >= maxSpans || level > MAX_DEPTH) return false;",
  "        167",
  "        219      }",
  "        220",
  "        221      // Sort root spans by duration and select the most interesting ones",
  "        222 -    const sortedRotots = spans",
  "        222 +    const sortedRoots = actualSpans",
  "        223        .sort((a, b) => (b.duration || 0) - (a.duration || 0))",
  "        224        .slice(0, 5); // Start with top 5 root spans",
  "        225",
  "        380    function getAllSpansFlattened(spans: any[]): any[] {",
  "        381      const result: any[] = [];",
  "        382",
  "        383 +    // Filter out non-span items (issues) from the trace data",
  "        384 +    // Spans must have children array and duration",
  "        385 +    const actualSpans = spans.filter(item =>",
  "        386 +      item &&",
  "        387 +      typeof item === 'object' &&",
  "        388 +      'children' in item &&",
  "        389 +      Array.isArray(item.children) &&",
  "        390 +      'duration' in item",
  "        391 +    );",
  "        392 +",
  "        393      function collectSpans(spanList: any[]) {",
  "        394        for (const span of spanList) {",
  "        395          result.push(span);",
  "      ...",
  "        389        }",
  "        390      }",
  "        391",
  "        392 -    collectSpans(spans);",
  "        392 +    collectSpans(actualSpans);",
  "        393      return result;",
  "        394    }",
  "        395      ",
];
const diff2 = [
  "      63      TraceMetaSchema,",
  "      64      TraceSchema,",
  "      65      TraceSpanSchema,",
  "      66 +    TraceIssueSchema,",
  "      67      UserSchema,",
  '      68    } from "./schema";',
  "      69",
  "      ---",
  "      93    // Trace types",
  "      94    export type TraceMeta = z.infer<typeof TraceMetaSchema>;",
  "      95    export type TraceSpan = z.infer<typeof TraceSpanSchema>;",
  "      96 +  export type TraceIssue = z.infer<typeof TraceIssueSchema>;",
  "      97    export type Trace = z.infer<typeof TraceSchema>;",
];
const diff3 = [
  "  617 +   * Schema for issue objects that can appear in trace responses.",
  "  618 +   *",
  "  619 +   * When Sentry's trace API returns standalone errors, they are returned as",
  "  620 +   * SerializedIssue objects that lack the span-specific fields.",
  "  621 +   */",
  "  622 +  export const TraceIssueSchema = z.object({",
  "  623 +    id: z.union([z.string(), z.number()]).optional(),",
  "  624 +    issue_id: z.union([z.string(), z.number()]).optional(),",
  "  625 +    project_id: z.union([z.string(), z.number()]).optional(),",
  "  626 +    project_slug: z.string().optional(),",
  "  627 +    title: z.string().optional(),",
  "  628 +    culprit: z.string().optional(),",
  "  629 +    type: z.string().optional(),",
  "  630 +    timestamp: z.union([z.string(), z.number()]).optional(),",
  "  631 +  }).passthrough();",
  "  632 +",
  "  633 +  /**",
  "  634     * Schema for Sentry trace response.",
  "  635     *",
  "  636     * Contains the complete trace tree starting from root spans.",
  "  637 -   * The response is an array of root-level spans, each potentially",
  "  638 -   * containing nested children spans.",
  "  637 +   * The response is an array that can contain both root-level spans",
  "  638 +   * and standalone issue objects. The Sentry API's query_trace_data",
  "  639 +   * function returns a mixed list of SerializedSpan and SerializedIssue",
  "  640 +   * objects when there are errors not directly associated with spans.",
  "  641     */",
  "  642 -  export const TraceSchema = z.array(TraceSpanSchema);",
  "  642 +  export const TraceSchema = z.array(",
  "  643 +    z.union([TraceSpanSchema, TraceIssueSchema])",
  "  644 +  );",
];
