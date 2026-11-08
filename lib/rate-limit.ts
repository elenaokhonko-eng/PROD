import type { NextRequest } from "next/server"

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
// whatever the client sent, so it is never trusted. Where Cloudflare proxies the site (production,
// HARBOR_TRUST_CLOUDFLARE_IP=true) CF-Connecting-IP is the client; elsewhere a client could forge that header, so the
// right-most X-Forwarded-For entry, appended by Render's proxy, is used.
export function clientIp(
  headers: Pick<Headers, "get">,
  fallback?: string | null,
  trustCloudflare = process.env.HARBOR_TRUST_CLOUDFLARE_IP === "true",
): string {
  const cloudflare = trustCloudflare ? headers.get("cf-connecting-ip")?.trim() : null
  if (cloudflare) return cloudflare
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean)
  if (forwarded?.length) return forwarded[forwarded.length - 1]
  return fallback ?? "unknown"
}

export function keyFrom(request: NextRequest | Request, route: string) {
  return `${route}:${clientIp(request.headers, (request as NextRequest).ip)}`
}
