import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "@sentry/mcp-server-mocks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../../");

// Load environment variables from multiple possible locations
// IMPORTANT: Do NOT use override:true as it would overwrite shell/CI environment variables

// Load local package .env first (for package-specific overrides)
config({ path: path.resolve(__dirname, "../.env") });

// Load root .env second (for shared defaults - won't override local or shell vars)
config({ path: path.join(rootDir, ".env") });

startMockServer({ ignoreOpenAI: true });
