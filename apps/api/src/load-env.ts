import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const path of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(path)) { process.loadEnvFile(path); break; }
}
