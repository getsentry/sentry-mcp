/**
 * Simple terminal output logger for the MCP client.
 *
 * In an ideal world, this would use a state manager to track the last active logger,
 * and it'd accept streams to the log functions. It'd then handle automatically
 * terminating a previous block, inserting a new block, and restarting the previous
 * block when streams receive new data. This is just a simplified version as this is
 * not a big concern in this project.
 */

import chalk from "chalk";

let responseStarted = false;

export const logError = (msg: string, detail?: any) =>
  console.log(
    `\n${chalk.red("●")} ${msg}${detail ? `\n  ⎿  ${chalk.gray(detail instanceof Error ? detail.message : detail)}` : ""}`,
  );

export const logSuccess = (msg: string, detail?: string) =>
  console.log(
    `\n${chalk.green("●")} ${msg}${detail ? `\n  ⎿  ${chalk.gray(detail)}` : ""}`,
  );

export const logInfo = (msg: string) =>
  console.log(`\n${chalk.blue("●")} ${msg}`);

export const logUser = (msg: string) =>
  console.log(`\n${chalk.gray(">")} ${chalk.gray(msg)}`);

export const logTool = (name: string, args?: any) => {
  const params =
    args && Object.keys(args).length > 0
      ? `(${Object.entries(args)
          .map(
            ([k, v]) =>
              `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
          )
          .join(", ")})`
      : "()";
  console.log(`\n${chalk.green("●")} ${name}${params}`);
};

export const logToolResult = (msg: string) =>
  console.log(`  ⎿  ${chalk.white(msg)}`);

export const logStreamStart = () => {
  if (!responseStarted) {
    process.stdout.write(`\n${chalk.white("●")} `);
    responseStarted = true;
  }
};

export const logStreamWrite = (chunk: string) =>
  process.stdout.write(chunk.replace(/\n/g, "\n  "));

export const logStreamEnd = () => {
  if (responseStarted) {
    console.log();
    responseStarted = false;
  }
};
