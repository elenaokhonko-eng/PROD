import assert from "node:assert/strict"

import { signAdminEdgeRequest, signEdgeRequest } from "../lib/server/edge-request-signing"
import {
  authorizeHarborEdgeRequest,
  HarborEdgeAuthError,
  verifyHarborEdgeRequest,
} from "../supabase/functions/_shared/edge-auth.ts"

const SECRET = "test-only-harbor-edge-secret-32-bytes-minimum"
const AUDIENCE = "run_case_extract_v4"
const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ACTOR_ID = "11111111-1111-4111-8111-111111111111"

type DenoShim = {
  env: { get: (name: string) => string | undefined }
}

function requestWith(
  headers: Record<string, string>,
  body: string,
  audience = AUDIENCE,
): Request {
  return new Request(`http://edge.test/functions/v1/${audience}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  })
}

function isAuthError(message: RegExp) {
  return (error: unknown): boolean =>
    error instanceof HarborEdgeAuthError && message.test(error.message)
}

export async function runEdgeAuthorizationContractTests(): Promise<void> {
  const priorSecret = process.env.EDGE_PROXY_HMAC_SECRET
  const runtime = globalThis as typeof globalThis & { Deno?: DenoShim }
  const priorDeno = runtime.Deno
  const originalNow = Date.now

  process.env.EDGE_PROXY_HMAC_SECRET = SECRET
  runtime.Deno = {
    env: { get: (name) => (name === "EDGE_PROXY_HMAC_SECRET" ? SECRET : undefined) },
  }

  try {
    const body = JSON.stringify({ case_id: CASE_ID, allow_partial_evidence: false })
    const context = { actorKind: "user" as const, actorId: ACTOR_ID, caseId: CASE_ID }

    await assert.rejects(
      verifyHarborEdgeRequest(
        requestWith(
          {
            apikey: "anon-test-token",
            authorization: "Bearer anon-test-token",
          },
          body,
        ),
        AUDIENCE,
      ),
      isAuthError(/Missing x-harbor-edge-version/),
      "a direct anon-key request must not authorize privileged Edge work",
    )

    const validHeaders = signEdgeRequest(AUDIENCE, body, context)
    const validSignature = validHeaders["x-harbor-edge-signature"]
    const badHeaders = {
      ...validHeaders,
      "x-harbor-edge-signature": `${validSignature.slice(0, -1)}${validSignature.endsWith("0") ? "1" : "0"}`,
    }
    await assert.rejects(
      verifyHarborEdgeRequest(requestWith(badHeaders, body), AUDIENCE),
      isAuthError(/Invalid request signature/),
    )

    Date.now = () => originalNow() - 10 * 60 * 1000
    const staleHeaders = signEdgeRequest(AUDIENCE, body, context)
    Date.now = originalNow
    await assert.rejects(
      verifyHarborEdgeRequest(requestWith(staleHeaders, body), AUDIENCE),
      isAuthError(/Stale signed request/),
    )

    const consumed = new Set<string>()
    const nonceAuthorizer = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        const requestId = String(args.p_request_id)
        if (consumed.has(requestId)) {
          return { data: null, error: { message: "replayed_edge_request" } }
        }
        consumed.add(requestId)
        return { data: true, error: null }
      },
    }

    const first = await verifyHarborEdgeRequest(requestWith(validHeaders, body), AUDIENCE)
    await authorizeHarborEdgeRequest(nonceAuthorizer, first.context)
    assert.equal(first.body.case_id, CASE_ID)
    assert.equal(first.context.actorId, ACTOR_ID)

    const replay = await verifyHarborEdgeRequest(requestWith(validHeaders, body), AUDIENCE)
    await assert.rejects(
      authorizeHarborEdgeRequest(nonceAuthorizer, replay.context),
      isAuthError(/replayed_edge_request/),
    )

    const adminAudience = "url_catalogue"
    const adminBody = JSON.stringify({ operation: "refresh" })
    const adminHeaders = signAdminEdgeRequest(adminAudience, adminBody, ACTOR_ID)
    const adminRequest = await verifyHarborEdgeRequest(
      requestWith(adminHeaders, adminBody, adminAudience),
      adminAudience,
    )
    assert.equal(adminRequest.context.actorKind, "admin")
    assert.equal(adminRequest.context.actorId, ACTOR_ID)
    assert.equal(adminRequest.context.caseId, null)
    assert.equal(adminHeaders.authorization, undefined)
    assert.equal(adminHeaders.apikey, undefined)
    assert.throws(
      () => signAdminEdgeRequest("process_evidence" as never, adminBody, ACTOR_ID),
      /not approved for admin signing/,
    )

    console.log("Signed Edge authorization contract tests passed")
  } finally {
    Date.now = originalNow
    if (priorSecret === undefined) delete process.env.EDGE_PROXY_HMAC_SECRET
    else process.env.EDGE_PROXY_HMAC_SECRET = priorSecret
    if (priorDeno === undefined) delete runtime.Deno
    else runtime.Deno = priorDeno
  }
}

if (process.argv[1]?.endsWith("test-edge-authorization.ts")) {
  runEdgeAuthorizationContractTests().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
