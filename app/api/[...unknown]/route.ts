// Brief W1 Addendum S2: an unknown API address answers with a short JSON 404, never the HTML not-found page and never
// a stack trace. Every real API route is more specific than this catch-all, so it only ever sees unknown paths.
const notFound = () =>
  Response.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

export const GET = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound
export const HEAD = notFound
export const OPTIONS = notFound
