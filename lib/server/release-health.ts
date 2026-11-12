const fullGitShaPattern = /^[0-9a-f]{40}$/i

export type ReleaseHealthResult = {
  status: 200 | 401 | 503
  body: { commitSha: string } | { error: string }
  headers: { "Cache-Control": "no-store" }
}

const noStoreHeaders = { "Cache-Control": "no-store" } as const

export function buildReleaseHealthResult(input: {
  authenticated: boolean
  renderGitCommit?: string
  // From lib/server/ai/model-health.ts: a configured AI model that no longer answers fails the release check.
  modelFailures?: string
}): ReleaseHealthResult {
  if (!input.authenticated) {
    return { status: 401, body: { error: "Unauthorized" }, headers: noStoreHeaders }
  }

  const commitSha = (input.renderGitCommit?.trim() || "").toLowerCase()
  if (!fullGitShaPattern.test(commitSha)) {
    return { status: 503, body: { error: "Release identity unavailable" }, headers: noStoreHeaders }
  }
  if (input.modelFailures) {
    return { status: 503, body: { error: `AI model unavailable: ${input.modelFailures}` }, headers: noStoreHeaders }
  }

  return { status: 200, body: { commitSha }, headers: noStoreHeaders }
}
