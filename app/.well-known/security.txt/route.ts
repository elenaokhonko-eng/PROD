import { SITE_ORIGIN } from '@/lib/seo/indexing'

// Brief W1 Addendum S6 (RFC 9116): how to report a security problem. Expires one year after each build.
export const dynamic = 'force-static'

export function GET() {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const body = [
    'Contact: mailto:info@guidebuoyai.sg',
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    '',
  ].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
