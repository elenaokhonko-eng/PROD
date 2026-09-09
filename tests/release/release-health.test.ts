import assert from "node:assert/strict"
import test from "node:test"
import { buildReleaseHealthResult } from "../../lib/server/release-health"
import { assertReleaseCommitSha } from "../../scripts/verify-harbor-preview-release"

const renderSha = "13136dd5f86536bcd38b5ec800fda7a36839ada5"
const fallbackSha = "233860fe47d9b5701b318f31c626b97ffd97b149"

test("release health rejects anonymous callers without disclosing the SHA", () => {
  const result = buildReleaseHealthResult({ authenticated: false, renderGitCommit: renderSha })
  assert.deepEqual(result, {
    status: 401,
    body: { error: "Unauthorized" },
    headers: { "Cache-Control": "no-store" },
  })
})

test("release health returns only the immutable Render SHA and disables caching", () => {
  const result = buildReleaseHealthResult({
    authenticated: true,
    renderGitCommit: renderSha.toUpperCase(),
    releaseCommitSha: fallbackSha,
  })
  assert.deepEqual(result, {
    status: 200,
    body: { commitSha: renderSha },
    headers: { "Cache-Control": "no-store" },
  })
  assert.deepEqual(Object.keys(result.body), ["commitSha"])
})

test("release health permits the server-configured fallback outside Render", () => {
  const result = buildReleaseHealthResult({ authenticated: true, releaseCommitSha: fallbackSha })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { commitSha: fallbackSha })
})

test("release health fails closed for missing or malformed deployment identity", () => {
  for (const renderGitCommit of [undefined, "", "short", `${renderSha}extra`]) {
    const result = buildReleaseHealthResult({ authenticated: true, renderGitCommit })
    assert.equal(result.status, 503)
    assert.deepEqual(result.body, { error: "Release identity unavailable" })
    assert.deepEqual(result.headers, { "Cache-Control": "no-store" })
  }
})

test("preview verifier requires an exact minimal matching SHA response", () => {
  assert.equal(assertReleaseCommitSha({ commitSha: renderSha.toUpperCase() }, renderSha), renderSha)
  assert.throws(() => assertReleaseCommitSha({ commitSha: fallbackSha }, renderSha), /does not match/)
  assert.throws(() => assertReleaseCommitSha({ commitSha: "short" }, renderSha), /malformed/)
  assert.throws(
    () => assertReleaseCommitSha({ commitSha: renderSha, observedAt: "unexpected" }, renderSha),
    /unexpected fields/,
  )
})
