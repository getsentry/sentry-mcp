#!/usr/bin/env node

/**
 * Simple bin script for running the MCP server directly.
 * This bypasses pnpm to avoid stdout pollution that breaks the MCP protocol.
 */

import { register } from "tsx/esm";

// Register tsx to handle TypeScript files
register();

// Import and run the main entry point
const entryPoint = new URL("../src/index.ts", import.meta.url);
await import(entryPoint.href);
