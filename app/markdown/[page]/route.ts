import { MARKDOWN_REWRITE_HEADER } from '@/lib/seo/markdown'
import { readMarkdownFile } from '@/lib/seo/markdown-files'
import { AGENT_LINK_HEADER, MARKDOWN_COPIES } from '@/lib/seo/public-routes.mjs'
import { SITE_ORIGIN } from '@/lib/seo/indexing'

// Addendum M §M4 and Addendum A §A3: serves the build-time markdown copy of an indexable page. Reached only through
// the middleware, at the page address plus ".md" or at the page address with Accept: text/markdown.
export const dynamic = 'force-dynamic'

// The same lifetime Next.js gives the prerendered HTML pages.
const PAGE_CACHE_CONTROL = 's-maxage=31536000, stale-while-revalidate'

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })

export async function GET(request: Request, { params }: { params: { page: string } }) {
  const copy = MARKDOWN_COPIES.find((entry) => entry.name === params.page)
  if (!copy || request.headers.get(MARKDOWN_REWRITE_HEADER) !== '1') return notFound()
  const body = await readMarkdownFile(`${copy.name}.md`)
  if (!body) return notFound()

  const canonical = `${SITE_ORIGIN}${copy.route === '/' ? '' : copy.route}`
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Vary: 'Accept',
      // §M4: search engines credit the HTML page.
      Link: `<${canonical}>; rel="canonical", ${AGENT_LINK_HEADER}`,
      'x-markdown-tokens': String(Math.ceil(body.length / 4)),
      'Cache-Control': PAGE_CACHE_CONTROL,
    },
  })
}
