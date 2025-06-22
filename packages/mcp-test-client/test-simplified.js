#!/usr/bin/env node

// Test simplified logger
import chalk from "chalk";

// Simulate the simplified logger functions
let streamStarted = false;

function logSuccess(message, details) {
  const detailText = details instanceof Error ? details.message : details;
  console.log(`\n${chalk.green("●")} ${message}`);
  if (detailText) console.log(`  ⎿  ${chalk.gray(detailText)}`);
}

function logUser(message) {
  console.log(`\n${chalk.magenta(">")} ${message}`);
}

function logTool(toolName, args) {
  let toolCall = toolName;
  if (args && Object.keys(args).length > 0) {
    const argsList = Object.entries(args)
      .map(([key, value]) => {
        const formattedValue =
          typeof value === "string" ? value : JSON.stringify(value);
        return `${key}: ${formattedValue}`;
      })
      .join(", ");
    toolCall = `${toolName}(${argsList})`;
  } else {
    toolCall = `${toolName}()`;
  }

  console.log(`\n${chalk.green("●")} ${toolCall}`);
}

function logToolResult(message) {
  console.log(`  ⎿  ${chalk.gray(message)}`);
}

function logStreamStart() {
  if (!streamStarted) {
    console.log(`\n${chalk.white("●")} Response`);
    process.stdout.write("  ⎿  ");
    streamStarted = true;
  }
}

function logStreamWrite(chunk) {
  const output = chunk.replace(/\n/g, "\n     ");
  process.stdout.write(output);
}

function logStreamEnd() {
  if (streamStarted) {
    console.log();
    streamStarted = false;
  }
}

// Test the simplified flow
console.log("=== Simplified Logger Test ===");

// Connection
logSuccess("Connected to MCP server (stdio)", "18 tools available");

// User input
logUser("Find recent high priority issues");

// Tool execution
logTool("sentry_search_issues", {
  query: "is:unresolved priority:high",
  limit: 10,
});
logToolResult("completed");

// Streaming response
logStreamStart();
logStreamWrite("I found 5 high-priority unresolved issues.\n\n");
logStreamWrite(
  "The most recent one is MCP-SERVER-DR8 which is an OAuth token\n",
);
logStreamWrite("exchange failure that occurred on December 22, 2024.");
logStreamEnd();

// The logger is now:
// - ~80 lines instead of 180+
// - Simple function exports instead of complex classes
// - Minimal state (just one boolean for streaming)
// - Easy to understand and maintain
