import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";

loadEnvironment({ path: resolve(process.cwd(), "../../.env"), quiet: true });
