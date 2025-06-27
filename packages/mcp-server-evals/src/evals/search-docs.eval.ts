import { describeEval } from "vitest-evals";
import { Factuality, TaskRunner } from "./utils";

describeEval("search-docs", {
  data: async () => {
    return [
      {
        input: "How do I set up error tracking with Sentry in JavaScript?",
        expected: [
          "# Documentation Search Results",
          "",
          '**Query**: "How do I set up error tracking with Sentry in JavaScript?"',
          "**Guide**: javascript",
          "",
          "Found",
          "- Focus on the technology the user is inquiring about.",
          "- These are just snippets. Use `get_doc(path='...')` to fetch the full content.",
          "",
          "platforms/javascript",
        ].join("\n"),
      },
      {
        input:
          "I need help configuring Sentry with React components and error boundaries",
        expected: [
          "# Documentation Search Results",
          "",
          '**Query**: "I need help configuring Sentry with React components and error boundaries"',
          "**Guide**: react",
          "",
          "Found",
          "- Focus on the technology the user is inquiring about.",
          "- These are just snippets. Use `get_doc(path='...')` to fetch the full content.",
          "",
          "javascript/react",
        ].join("\n"),
      },
      {
        input: "What is Sentry's rate limiting and how does it work?",
        expected: [
          "# Documentation Search Results",
          "",
          '**Query**: "What is Sentry\'s rate limiting and how does it work?"',
          "",
          "Found",
          "- Focus on the technology the user is inquiring about.",
          "- These are just snippets. Use `get_doc(path='...')` to fetch the full content.",
          "",
          "rate limiting",
          "product/rate-limiting",
        ].join("\n"),
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
