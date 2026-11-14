import { readMarkdownFile } from '@/lib/seo/markdown-files'

// Addendum M §M5: every markdown copy in menu order, built with them after the pages were prerendered.
export const dynamic = 'force-dynamic'

export async function GET() {
  const body = await readMarkdownFile('llms-full.txt')
  if (!body) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
