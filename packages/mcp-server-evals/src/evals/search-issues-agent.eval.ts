import { describeSearchAgentEval, searchIssuesAgentHarness } from "./utils";
import "../setup-env";

// The shared MSW server is already started in setup-env.ts

describeSearchAgentEval("search-issues-agent", searchIssuesAgentHarness, [
  {
    // Simple query with common fields - should NOT require tool calls
    input: "Show me unresolved issues",
    expectedTools: [],
    expected: {
      query: "is:unresolved",
      sort: "date", // Agent uses "date" as default
    },
  },
  {
    // Natural-language "me" reference should resolve through whoami.
    input: "Show me issues assigned to me",
    expectedTools: [
      {
        name: "whoami",
      },
    ],
    expected: {
      query:
        /assigned_or_suggested:test@example\.com|assigned:test@example\.com|assigned:me/, // Various valid forms
    },
  },
  {
    // Explicit "me" is valid Sentry syntax and should not be resolved.
    input: "assigned:me is:unresolved",
    expectedTools: [],
    expected: {
      query: /(?=.*assigned:me)(?=.*is:unresolved)/,
    },
  },
  {
    // Complex query but with common fields - should NOT require tool calls
    input: "Show me critical unhandled errors from the last 24 hours",
    expectedTools: [],
    expected: {
      query:
        /(?=.*is:unresolved)(?=.*error\.handled:false)(?=.*lastSeen:(?:-24h|>-24h))/,
      sort: /date|user/,
    },
  },
  {
    // Tag-presence query can be expressed directly with has:
    input: "Show me issues with custom.payment.failed tag",
    expectedTools: [],
    expected: {
      query:
        /has:custom\.payment\.failed|custom\.payment\.failed|tags\[custom\.payment\.failed\]/, // All are valid tag forms
      sort: "date", // Agent should always return a sort value
    },
  },
  {
    // Custom tag queries may either use field discovery or direct tag syntax.
    input: "Find issues where the kafka.consumer.group is orders-processor",
    expectedTools: [],
    expected: {
      query:
        /kafka\.consumer\.group:orders-processor|tags\[kafka\.consumer\.group\]:orders-processor/,
    },
  },
  {
    // Easy to fix issues - should use seer_actionability filter
    input: "Show me easy to fix bugs",
    expectedTools: [],
    expected: {
      query: /issue\.seer_actionability/,
      sort: "date",
    },
  },
  {
    // Quick wins query - should combine actionability with unresolved
    input: "Show me quick wins in production",
    expectedTools: [],
    expected: {
      query:
        /issue\.seer_actionability.*environment:production|environment:production.*issue\.seer_actionability/,
      sort: /date|user/,
    },
  },
  {
    // Explicit issue-search syntax should be preserved, not broadened.
    input: "is:for_review release:latest assigned:me issue.priority:high",
    expectedTools: [],
    expected: {
      query:
        /(?=.*is:for_review)(?=.*release:latest)(?=.*assigned:me)(?=.*issue\.priority:high)/,
    },
  },
  {
    // Mixed natural language may set sort, but explicit filters stay intact.
    input: "sort by users is:for_review release:latest",
    expectedTools: [],
    expected: {
      query: /^(?!.*sort:)(?=.*is:for_review)(?=.*release:latest)/,
      sort: "user",
    },
  },
  {
    // Valid inbox/substatus filters should not be generalized.
    input: "is:new is:regressed",
    expectedTools: [],
    expected: {
      query: /^(?!.*is:unresolved)(?=.*is:new)(?=.*is:regressed)/,
    },
  },
]);
