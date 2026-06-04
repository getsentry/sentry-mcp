import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from multiple possible locations
// IMPORTANT: Do NOT use override:true as it would overwrite shell/CI environment variables
const rootDir = path.resolve(__dirname, "../../../");

// Load more specific local files first so defaults do not override them.
config({ path: path.resolve(__dirname, "../.env.local") });
config({ path: path.resolve(__dirname, "../.env") });

// Load root defaults last (won't override local or shell/CI vars).
config({ path: path.join(rootDir, ".env.local") });
config({ path: path.join(rootDir, ".env") });

// Start the shared MSW server for all eval tests
import { startMockServer } from "@sentry/mcp-server-mocks/utils";

startMockServer({ ignoreOpenAI: true });
