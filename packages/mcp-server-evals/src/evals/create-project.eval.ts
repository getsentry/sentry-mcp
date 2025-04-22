import { describeEval } from "vitest-evals";
import { Factuality, FIXTURES, TaskRunner } from "./utils";

describeEval("create-project", {
  data: async () => {
    return [
      {
        input: `Create a new project in Sentry for '${FIXTURES.organizationSlug}' called '${FIXTURES.projectSlug}' with the '${FIXTURES.teamSlug}' team. Output **only** the project slug and the SENTRY_DSN in the format of:\n<PROJECT_SLUG>\n<SENTRY_DSN>`,
        expected:
          "cloudflare-mcp\nhttps://d20df0a1ab5031c7f3c7edca9c02814d@o4509106732793856.ingest.us.sentry.io/4509109104082945",
      },
    ];
  },
  task: TaskRunner(),
  scorers: [Factuality()],
  threshold: 0.6,
  timeout: 30000,
});
