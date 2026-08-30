import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const commitSha = (process.env.RELEASE_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "").trim() || null

  return NextResponse.json(
    {
      commitSha,
      observedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  )
}
