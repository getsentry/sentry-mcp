#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  evaluateDeployment,
  parseDeploymentJournal,
  parseDeploymentList,
  parseDeploymentStatus,
  parseWranglerJsonl,
} from "./cloudflare-deployment.mjs";

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function main(args) {
  const [command, ...operands] = args;
  switch (command) {
    case "snapshot": {
      if (operands.length !== 2) {
        throw new Error(
          "Usage: cloudflare-deployment-cli.mjs snapshot <status> <history>",
        );
      }
      writeJson({
        current: parseDeploymentStatus(readText(operands[0])),
        history: parseDeploymentList(readText(operands[1])),
      });
      return;
    }
    case "wrangler": {
      if (operands.length !== 2) {
        throw new Error(
          "Usage: cloudflare-deployment-cli.mjs wrangler <jsonl> <expectation>",
        );
      }
      writeJson(
        parseWranglerJsonl(readText(operands[0]), readJson(operands[1])),
      );
      return;
    }
    case "journal": {
      if (operands.length !== 1) {
        throw new Error(
          "Usage: cloudflare-deployment-cli.mjs journal <journal>",
        );
      }
      writeJson(parseDeploymentJournal(readJson(operands[0])));
      return;
    }
    case "evaluate": {
      if (operands.length !== 2) {
        throw new Error(
          "Usage: cloudflare-deployment-cli.mjs evaluate <snapshot> <journal>",
        );
      }
      writeJson(
        evaluateDeployment(readJson(operands[0]), readJson(operands[1])),
      );
      return;
    }
    default:
      throw new Error(
        `Unknown cloudflare-deployment command: ${command ?? ""}`,
      );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
