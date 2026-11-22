import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { paidStagesFrom } from "../../scripts/read-preview-paid-stages"

test("the authenticated lane reads paid stages from staging's capabilities answer", () => {
  assert.equal(paidStagesFrom({ access: { paidStagesEnabled: true } }), true)
  assert.equal(paidStagesFrom({ access: { paidStagesEnabled: false } }), false)
  for (const body of [null, {}, { access: {} }, { access: { paidStagesEnabled: "true" } }]) {
    assert.throws(() => paidStagesFrom(body), /did not say whether paid stages are on/)
  }
})

test("the workflow reads paid stages before the authenticated Playwright run", () => {
  const workflow = readFileSync(".github/workflows/harbor-release-gates.yml", "utf8")
  const read = workflow.indexOf("scripts/read-preview-paid-stages.ts")
  const run = workflow.indexOf("--config=tests/e2e/playwright.authenticated.config.ts")
  assert.ok(read > 0 && run > read)
})
