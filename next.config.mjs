import { AGENT_LINK_HEADER, CRAWL_FILE_CACHE_CONTROL, CRAWL_FILE_PATHS, INDEXABLE_ROUTES } from './lib/seo/public-routes.mjs'

// Security headers on every response (Elena, 9 Nov). The CSP only restricts framing, <base> and plugins; a full script
// policy needs testing against Clerk first. HSTS has no preload: preloading is hard to undo.
export const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Voice input needs the microphone on our own pages.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // instrumentation.ts: AI model health check at startup (Next 14 still gates the hook behind this flag).
  experimental: {
    instrumentationHook: true,
  },
  // Retired routes. Declared here rather than with redirect() in a page, because Next 14.2 serves a prerendered
  // page's cached redirect as a 307 without its Location header.
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      ...INDEXABLE_ROUTES.map((source) => ({ source, headers: [{ key: 'Link', value: AGENT_LINK_HEADER }] })),
      ...CRAWL_FILE_PATHS.map((source) => ({ source, headers: [{ key: 'Cache-Control', value: CRAWL_FILE_CACHE_CONTROL }] })),
    ]
  },
  async redirects() {
    return [
      { source: '/coming-soon', destination: '/marketplace', permanent: false },
      { source: '/marketplace/volunteers', destination: '/marketplace', permanent: false },
    ]
  },
}

export default nextConfig
