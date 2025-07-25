import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env files in priority order (later files override earlier ones)
// 1. Root workspace .env
// 2. Root workspace .env.local (for local overrides)
// 3. Local package .env (higher priority)

// Load root workspace .env first
const rootDir = path.resolve(__dirname, "../../../");
config({ path: path.join(rootDir, ".env") });

// Load root workspace .env.local (for local overrides)
config({ path: path.join(rootDir, ".env.local") });

// Load local package .env (will override root if same keys exist)
config({ path: path.resolve(__dirname, "../.env") });
