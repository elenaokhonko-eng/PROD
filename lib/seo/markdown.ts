import { MARKDOWN_COPIES } from './public-routes.mjs'

// Addendum M §M3: the format follows what the client asks for in its Accept header, never who the client is. Markdown
// only when text/markdown is named and ranked above text/html; a browser's default header and */* get the HTML page.

type MediaRange = { type: string; q: number }

function parseAccept(accept: string): MediaRange[] {
  return accept
    .split(',')
    .map((part) => {
      const [type, ...params] = part.trim().toLowerCase().split(';').map((piece) => piece.trim())
      const qParam = params.find((param) => param.startsWith('q='))
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1
      return { type, q: Number.isFinite(q) ? q : 0 }
    })
    .filter((range) => range.type)
}

const quality = (ranges: MediaRange[], ...types: string[]) => {
  for (const type of types) {
    const match = ranges.find((range) => range.type === type)
    if (match) return match.q
  }
  return 0
}

export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false
  const ranges = parseAccept(accept)
  const markdown = quality(ranges, 'text/markdown')
  return markdown > 0 && markdown > quality(ranges, 'text/html', 'text/*', '*/*')
}

/** The copy's file name for a `.md` address, or null when there is no copy (account, app and API routes, §M6.5). */
export function markdownNameForPath(pathname: string): string | null {
  if (!pathname.endsWith('.md')) return null
  const name = pathname.slice(1, -'.md'.length)
  return MARKDOWN_COPIES.some((copy) => copy.name === name) ? name : null
}

/** The copy's file name for an indexable page address, or null. */
export function markdownNameForRoute(pathname: string): string | null {
  return MARKDOWN_COPIES.find((copy) => copy.route === pathname)?.name ?? null
}

// Marks a request the middleware rewrote to a copy, so the copies are not also served at a second public address.
export const MARKDOWN_REWRITE_HEADER = 'x-guidebuoy-markdown'
export const MARKDOWN_ROUTE_PREFIX = '/markdown/'
