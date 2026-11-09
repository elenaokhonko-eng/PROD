import type { NextRequest } from "next/server"
import { isCloudflareIp, parseIp } from "./cloudflare-ips"

type Hit = { count: number; expiresAt: number }

const buckets = new Map<string, Hit>()

export function rateLimit(key: string, limit = 20, windowMs = 60_000): { ok: boolean; remaining: number; reset: number } {
  const now = Date.now()
  const hit = buckets.get(key)
  if (!hit || hit.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + windowMs })
    return { ok: true, remaining: limit - 1, reset: now + windowMs }
  }
  if (hit.count >= limit) {
    return { ok: false, remaining: 0, reset: hit.expiresAt }
  }
  hit.count += 1
  return { ok: true, remaining: Math.max(0, limit - hit.count), reset: hit.expiresAt }
}

// The client's address for rate limiting (cost-controls inventory, 8 Nov): the first X-Forwarded-For entry is
// whatever the client sent, so it is never trusted. The right-most entry is appended by Render's proxy: the address
// that actually connected. CF-Connecting-IP is believed only when HARBOR_TRUST_CLOUDFLARE_IP=true AND that connecting
// address is in Cloudflare's published ranges (Elena, 9 Nov): a request sent straight to the *.onrender.com address
// with a forged CF-Connecting-IP comes from a non-Cloudflare address and is keyed by that address instead.
export function clientIp(
  headers: Pick<Headers, "get">,
  fallback?: string | null,
  trustCloudflare = process.env.HARBOR_TRUST_CLOUDFLARE_IP === "true",
): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean)
  const peer = forwarded?.length ? forwarded[forwarded.length - 1] : null
  if (trustCloudflare && peer && isCloudflareIp(peer)) {
    const cloudflare = headers.get("cf-connecting-ip")?.trim()
    if (cloudflare && parseIp(cloudflare)) return cloudflare
  }
  if (peer) return peer
  return fallback ?? "unknown"
}

export function keyFrom(request: NextRequest | Request, route: string) {
  return `${route}:${clientIp(request.headers, (request as NextRequest).ip)}`
}
