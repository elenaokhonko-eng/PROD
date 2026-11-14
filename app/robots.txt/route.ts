import { ROBOTS_TXT } from '@/lib/seo/indexing'

// A route handler rather than app/robots.ts so the file matches brief W1 §L1 line for line.
export function GET() {
  return new Response(ROBOTS_TXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
