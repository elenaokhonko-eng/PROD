import assert from "node:assert/strict"
import test from "node:test"
import { Webhook } from "svix"
import { handleClerkWebhook } from "../../lib/server/clerk-webhook"

const signingSecret = `whsec_${Buffer.from("deterministic-clerk-webhook-test-secret").toString("base64")}`
const webhookId = "msg_test_clerk_profile"
const userId = "user_fixtureA"

function signedRequest(payload: string, secret = signingSecret) {
  const timestamp = new Date()
  const signature = new Webhook(secret).sign(webhookId, timestamp, payload)
  return new Request("https://staging.example.test/api/webhooks/clerk", {
    method: "POST",
    body: payload,
    headers: {
      "content-type": "application/json",
      "svix-id": webhookId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
  })
}

test("Clerk webhook rejects missing and invalid signatures", async () => {
  const provisionUser = async () => undefined
  const missing = await handleClerkWebhook(
    new Request("https://staging.example.test/api/webhooks/clerk", { method: "POST", body: "{}" }),
    { signingSecret, provisionUser },
  )
  assert.equal(missing.status, 400)
  assert.deepEqual(await missing.json(), { error: "Invalid webhook signature" })

  const invalid = await handleClerkWebhook(
    new Request("https://staging.example.test/api/webhooks/clerk", {
      method: "POST",
      body: "{}",
      headers: {
        "svix-id": webhookId,
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,invalid",
      },
    }),
    { signingSecret, provisionUser },
  )
  assert.equal(invalid.status, 400)
})

test("Clerk webhook provisions a signed user.created event and accepts safe replay", async () => {
  const payload = JSON.stringify({ type: "user.created", data: { id: userId } })
  const provisioned = new Set<string>()
  let deliveries = 0
  const provisionUser = async (receivedUserId: string) => {
    deliveries += 1
    provisioned.add(receivedUserId)
  }

  const first = await handleClerkWebhook(signedRequest(payload), { signingSecret, provisionUser })
  const replay = await handleClerkWebhook(signedRequest(payload), { signingSecret, provisionUser })
  assert.equal(first.status, 200)
  assert.equal(replay.status, 200)
  assert.deepEqual(await first.json(), { status: "provisioned" })
  assert.equal(deliveries, 2)
  assert.deepEqual([...provisioned], [userId])
})

test("Clerk webhook ignores unrelated signed events without provisioning", async () => {
  let called = false
  const response = await handleClerkWebhook(
    signedRequest(JSON.stringify({ type: "session.created", data: { id: "session_fixture" } })),
    { signingSecret, provisionUser: async () => { called = true } },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "ignored" })
  assert.equal(called, false)
})

test("Clerk webhook returns sanitized failures without identity disclosure", async () => {
  const payload = JSON.stringify({ type: "user.created", data: { id: userId } })
  const response = await handleClerkWebhook(signedRequest(payload), {
    signingSecret,
    provisionUser: async () => { throw new Error(`sensitive ${userId}`) },
  })
  assert.equal(response.status, 500)
  const body = JSON.stringify(await response.json())
  assert.equal(body.includes(userId), false)
  assert.deepEqual(JSON.parse(body), { error: "Profile provisioning failed" })
})

// Elena, 9 Nov: the webhook fails closed. No secret, or a payload signed with another secret, never provisions.
test("Clerk webhook fails closed when its secret is missing or wrong", async () => {
  let provisioned = 0
  const provisionUser = async () => { provisioned += 1 }
  const payload = JSON.stringify({ type: "user.created", data: { id: userId } })
  for (const secret of [undefined, "", "   "]) {
    const response = await handleClerkWebhook(signedRequest(payload), { signingSecret: secret, provisionUser })
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: "Webhook is not configured" })
  }
  const otherSecret = `whsec_${Buffer.from("a-different-clerk-webhook-secret").toString("base64")}`
  const wrong = await handleClerkWebhook(signedRequest(payload, otherSecret), { signingSecret, provisionUser })
  assert.equal(wrong.status, 400)
  assert.equal(provisioned, 0)
})
