import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { checkModelHealth, describeFailures } from "@/lib/server/ai/model-health"
import { buildReleaseHealthResult } from "@/lib/server/release-health"

export const dynamic = "force-dynamic"

export async function GET() {
  const { userId } = await auth()
  const modelHealth = userId ? await checkModelHealth() : null
  const result = buildReleaseHealthResult({
    authenticated: Boolean(userId),
    renderGitCommit: process.env.RENDER_GIT_COMMIT,
    modelFailures: modelHealth && !modelHealth.ok ? describeFailures(modelHealth) : undefined,
  })

  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  })
}
