import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  persistAcceptedAnswer,
  restoreAcceptedResponses,
  type RouterResponses,
} from "../app/router/questions/question-persistence"

const questionsSource = readFileSync("app/router/questions/page.tsx", "utf8")

describe("Router B3 answer durability", () => {
  it("persists the accepted answer before advancing and preserves it while pending", async () => {
    const events: string[] = []
    const payloads: RouterResponses[] = []
    let finishPersist: (value: unknown) => void = () => undefined

    const pendingSave = persistAcceptedAnswer({
      sessionToken: "router-session",
      responses: { first: "accepted" },
      questionKey: "second",
      answer: "entered answer",
      persist: async (_token, update) => {
        events.push("persist")
        payloads.push(update.user_responses)
        return new Promise((resolve) => { finishPersist = resolve })
      },
      onPersisted: () => events.push("advance"),
    })

    assert.deepEqual(events, ["persist"])
    assert.deepEqual(payloads, [{ first: "accepted", second: "entered answer" }])

    finishPersist({ session_token: "router-session" })
    await pendingSave
    assert.deepEqual(events, ["persist", "advance"])
  })

  it("keeps the question in place after failure and retries without losing or duplicating the answer", async () => {
    const payloads: RouterResponses[] = []
    let advances = 0
    let shouldSucceed = false
    const save = () => persistAcceptedAnswer({
      sessionToken: "router-session",
      responses: { first: "accepted" },
      questionKey: "second",
      answer: "retry me",
      persist: async (_token, update) => {
        payloads.push(update.user_responses)
        return shouldSucceed ? { session_token: "router-session" } : null
      },
      onPersisted: () => { advances += 1 },
    })

    await assert.rejects(save(), /could not be saved/)
    assert.equal(advances, 0)

    shouldSucceed = true
    await save()
    assert.equal(advances, 1)
    assert.deepEqual(payloads, [
      { first: "accepted", second: "retry me" },
      { first: "accepted", second: "retry me" },
    ])
  })

  it("restores previously accepted string and numeric answers from the session", () => {
    assert.deepEqual(
      restoreAcceptedResponses({ text: "saved", amount: 18, ignored: false, empty: null }),
      { text: "saved", amount: "18" },
    )
    assert.deepEqual(restoreAcceptedResponses(null), {})
  })

  it("gates both question advance and results navigation behind persistence success", () => {
    assert.match(
      questionsSource,
      /await persistAcceptedAnswer\([\s\S]*onPersisted:[\s\S]*setCurrentStep\([\s\S]*router\.push\("\/router\/results"\)/,
    )

  })

  it("keeps the mobile primary action safe-area sticky and accessibly described", () => {
    assert.match(questionsSource, /sticky bottom-0/)
    assert.match(questionsSource, /env\(safe-area-inset-bottom\)/)
    assert.match(questionsSource, /sm:static/)
    assert.match(questionsSource, /scroll-pb-32/)
    assert.match(questionsSource, /aria-describedby="answer-save-status"/)
    assert.match(questionsSource, /id="answer-save-status"[\s\S]*aria-live="polite"/)
    assert.match(questionsSource, /Retry saving/)
    assert.match(questionsSource, /saveInFlightRef\.current/)
  })
})