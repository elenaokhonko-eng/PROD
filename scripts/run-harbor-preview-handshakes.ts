import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const baseUrl = process.env.HARBOR_PREVIEW_BASE_URL?.trim()
if (!baseUrl) {
  throw new Error("HARBOR_PREVIEW_BASE_URL is required")
}

const require = createRequire(import.meta.url)
const playwrightCli = require.resolve("@playwright/test/cli")
const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", "tests/e2e/harbor-preview-handshakes.spec.ts", "--workers=1"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HARBOR_PREVIEW_HANDSHAKES: "1",
      SLICE5_BASE_URL: baseUrl,
      SLICE5_AUTH_STORAGE_STATE:
        process.env.HARBOR_PREVIEW_AUTH_STORAGE_STATE ?? "tests/e2e/.auth/harbor-preview.json",
      SLICE5_SKIP_WEB_SERVER: "1",
    },
  },
)

if (result.error) throw result.error
if (result.status === 0) {
  console.log(
    `Timestamped evidence: ${process.env.HARBOR_PREVIEW_EVIDENCE_FILE ?? "test-results/harbor-preview-handshake-evidence.jsonl"}`,
  )
}
process.exitCode = result.status ?? 1
