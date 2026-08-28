const SITE_HEADER_ROUTES = new Set([
  "/",
  "/about",
  "/analytics",
  "/coming-soon",
  "/faq",
  "/how-it-works",
  "/marketplace",
  "/pricing",
  "/resources",
  "/router",
  "/app/settings",
])

export function routeOwnsModeSwitcher(pathname: string): boolean {
  const normalized = pathname === "/" ? pathname : pathname.replace(/\/+$/, "")
  return (
    SITE_HEADER_ROUTES.has(normalized) ||
    /^\/app\/case\/[^/]+\/dashboard(?:\/.*)?$/.test(normalized)
  )
}
