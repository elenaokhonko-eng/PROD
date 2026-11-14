import { INDEXABLE_ROUTES, SITE_ORIGIN } from '@/lib/seo/indexing'

// A route handler rather than app/sitemap.ts: Next adds its own "max-age=0, must-revalidate" to metadata routes, which
// clashed with the 1-hour cache set for crawl files in next.config.mjs. Sitemaps protocol 0.9.
export const dynamic = 'force-static'

export function GET() {
  const lastModified = new Date().toISOString()
  const urls = INDEXABLE_ROUTES.map(
    (path) => `<url>\n<loc>${SITE_ORIGIN}${path === '/' ? '' : path}</loc>\n<lastmod>${lastModified}</lastmod>\n</url>`,
  )
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
