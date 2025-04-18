import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("list-tags", {
  data: async () => {
    return [
      {
        input: `What are common tags in ${FIXTURES.organizationSlug}`,
        expected: [
          "- transaction",
          "- runtime.name",
          "- level",
          "- device",
          "- os",
          "- user",
          "- runtime",
          "- release",
          "- url",
          "- uptime_rule",
          "- server_name",
          "- browser",
          "- os.name",
          "- device.family",
          "- replayId",
          "- client_os.name",
          "- environment",
          "- service",
          "- browser.name",
        ].join("\n"),
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
