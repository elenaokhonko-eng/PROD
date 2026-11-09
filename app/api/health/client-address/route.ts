import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { isCloudflareIp } from "@/lib/cloudflare-ips"
import { clientIp } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// Release check (Elena, 9 Nov): shows the caller which address the per-IP limits would use for this request, and the
// forwarding headers it was derived from, so the Cloudflare trust rule can be verified on staging and on production
// before cutover. Only the caller's own addresses are returned, nothing is logged, and it needs the worker secret.
function authorised(given: string | null): boolean {
  const secret = process.env.WORKER_SECRET ?? ""
  if (!secret || !given) return false
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authorised(request.headers.get("x-harbor-diagnostic"))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean)
  const peer = forwarded[forwarded.length - 1] ?? null
  return NextResponse.json(
    {
      forwardedFor: forwarded,
      peer,
      peerIsCloudflare: peer ? isCloudflareIp(peer) : false,
      cfConnectingIp: request.headers.get("cf-connecting-ip"),
      trueClientIp: request.headers.get("true-client-ip"),
      xRealIp: request.headers.get("x-real-ip"),
      trustCloudflare: process.env.HARBOR_TRUST_CLOUDFLARE_IP === "true",
      resolved: clientIp(request.headers),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
