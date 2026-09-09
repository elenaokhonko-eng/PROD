import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { buildReleaseHealthResult } from "@/lib/server/release-health"

export const dynamic = "force-dynamic"

export async function GET() {
  const { userId } = await auth()
  const result = buildReleaseHealthResult({
    authenticated: Boolean(userId),
    renderGitCommit: process.env.RENDER_GIT_COMMIT,
    releaseCommitSha: process.env.RELEASE_COMMIT_SHA,
  })

  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  })
}
