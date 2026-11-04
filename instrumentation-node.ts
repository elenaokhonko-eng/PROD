// Checks that every configured AI model still answers at startup and then hourly; a failure is logged as
// ai_model_unavailable and emailed to ADMIN_EMAIL (lib/server/ai/model-health.ts). Render deployments only.
import { checkModelHealth } from "@/lib/server/ai/model-health"

const MODEL_CHECK_INTERVAL_MS = 60 * 60_000

if (process.env.RENDER_GIT_COMMIT && process.env.NEXT_PHASE !== "phase-production-build") {
  const run = () => void checkModelHealth({ force: true }).catch(() => undefined)
  run()
  setInterval(run, MODEL_CHECK_INTERVAL_MS).unref()
}
