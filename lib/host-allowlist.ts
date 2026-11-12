// Production answers only on its own domains (Elena, 9 Nov). The Render service is also reachable at its *.onrender.com
// address; refusing other hosts keeps every visitor on the path where Cloudflare's protections and the site's cookies
// apply. HARBOR_ALLOWED_HOSTS is a comma-separated list (for example "guidebuoyai.sg,www.guidebuoyai.sg"); unset, every
// host is allowed (staging, CI and local runs). /api/health/* stays reachable for release checks.
export function allowedHosts(env: Record<string, string | undefined> = process.env): string[] {
  return (env.HARBOR_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

export function hostAllowed(host: string | null, pathname: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true
  if (pathname === "/api/health" || pathname.startsWith("/api/health/")) return true
  const name = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
  return allowed.includes(name)
}
