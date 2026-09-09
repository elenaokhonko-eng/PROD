import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { buildReleaseHealthResult } from "../../lib/server/release-health"
import { assertReleaseCommitSha } from "../../scripts/verify-harbor-preview-release"

const renderSha = "13136dd5f86536bcd38b5ec800fda7a36839ada5"
const otherSha = "233860fe47d9b5701b318f31c626b97ffd97b149"
const root = process.cwd()
const releaseRoute = readFileSync(resolve(root, "app", "api", "health", "release", "route.ts"), "utf8")
const worker = readFileSync(resolve(root, "worker", "index.ts"), "utf8")
const renderBlueprint = readFileSync(resolve(root, "render.yaml"), "utf8")
const mutableShaVariablePattern = new RegExp(["RELEASE", "COMMIT", "SHA"].join("_"))

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
  })
  assert.deepEqual(result, {
    status: 200,
    body: { commitSha: renderSha },
    headers: { "Cache-Control": "no-store" },
  })
  assert.deepEqual(Object.keys(result.body), ["commitSha"])
})

test("release health ignores a manually configured SHA and fails closed outside Render", () => {
  const untrustedInput = {
    authenticated: true,
    releaseCommitSha: otherSha,
  } as unknown as Parameters<typeof buildReleaseHealthResult>[0]
  const result = buildReleaseHealthResult(untrustedInput)
  assert.equal(result.status, 503)
  assert.deepEqual(result.body, { error: "Release identity unavailable" })
})

test("app, worker, and Render blueprint contain no mutable release SHA contract", () => {
  assert.doesNotMatch(releaseRoute, mutableShaVariablePattern)
  assert.doesNotMatch(worker, mutableShaVariablePattern)
  assert.doesNotMatch(renderBlueprint, mutableShaVariablePattern)
  assert.match(worker, /process\.env\.RENDER_GIT_COMMIT/)
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
  assert.throws(() => assertReleaseCommitSha({ commitSha: otherSha }, renderSha), /does not match/)
  assert.throws(() => assertReleaseCommitSha({ commitSha: "short" }, renderSha), /malformed/)
  assert.throws(
    () => assertReleaseCommitSha({ commitSha: renderSha, observedAt: "unexpected" }, renderSha),
    /unexpected fields/,
  )
})
