import { mswServer } from "@sentry/mcp-server-mocks";

mswServer.listen({
  onUnhandledRequest: (req, print) => {
    if (req.url.startsWith("https://api.openai.com/")) {
      return;
    }

    print.warning();
    throw new Error("Unhandled request");
  },
  // onUnhandledRequest: "error"
});
