import type { ZodError } from "zod"
import { logger } from "@/lib/logger"

// Cutover checklist, week one (R-02): a refused case start or checkout leaves a line in the logs, so a failure like
// R-02 is visible. Reason codes, statuses, field names and IDs only: never the story, an amount or an error text.
export function logRefusal(route: "case_start" | "checkout", reason: string, status: number, meta: Record<string, unknown> = {}) {
  logger.warn("request refused", { route, reason, status, ...meta })
}

/** Which fields failed validation and how (for example `narrative:too_big`), without their values. */
export function invalidFields(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}:${issue.code}`)
}
