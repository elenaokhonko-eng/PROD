const DEFAULT_APP_URL = "https://guidebuoyaisg.onrender.com"

const ensureProtocol = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

const safeOrigin = (value: string | undefined | null): string | null => {
  if (!value) return null
  try {
    return new URL(ensureProtocol(value)).origin
  } catch {
    return null
  }
}

const isLocalOrigin = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(origin)

export const getAppBaseUrl = () => {
  const envOrigins = [
    safeOrigin(process.env.NEXT_PUBLIC_SITE_URL),
    safeOrigin(process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL),
    safeOrigin(process.env.NEXT_PUBLIC_APP_URL),
  ].filter((origin): origin is string => Boolean(origin))

  if (process.env.NODE_ENV === "production") {
    const nonLocalOrigin = envOrigins.find((origin) => !isLocalOrigin(origin))
    if (nonLocalOrigin) return nonLocalOrigin
  }

  const envOrigin = envOrigins[0]

  if (envOrigin) return envOrigin

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin
  }

  return DEFAULT_APP_URL
}

export const buildAppUrl = (path = "/") => {
  const base = getAppBaseUrl()
  try {
    return new URL(path, base).toString()
  } catch {
    const sanitizedBase = base.replace(/\/$/, "")
    return `${sanitizedBase}${path.startsWith("/") ? path : `/${path}`}`
  }
}
