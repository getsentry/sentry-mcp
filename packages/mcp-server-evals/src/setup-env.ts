import { config } from "dotenv";
import path from "node:path";

// Load .env files in priority order (later files override earlier ones)
// 1. Root workspace .env
// 2. Local package .env (higher priority)

// Load root workspace .env first
config({ path: path.resolve(process.cwd(), "../../.env") });

// Load local package .env (will override root if same keys exist)
config({ path: path.resolve(process.cwd(), ".env") });
