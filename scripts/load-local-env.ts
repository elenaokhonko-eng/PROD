import { resolve } from "node:path"
import { config as loadEnvFile } from "dotenv"

// .env.local must override pre-set shell env (e.g. stale $env:OPENAI_API_KEY in PowerShell).
loadEnvFile({ path: resolve(process.cwd(), ".env.local"), quiet: true, override: true })
loadEnvFile({ path: resolve(process.cwd(), ".env"), quiet: true })