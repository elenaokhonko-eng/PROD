// Cost-controls spec §3 A1: no model or server key ever reaches the browser. Run after `pnpm build`:
//   node_modules/.bin/tsx scripts/check-client-bundle.mts
// Fails if the client bundle (.next/static) contains a server secret pattern or the literal value of a server key set
// in this environment, or if any NEXT_PUBLIC_* variable named in the code looks like a server secret. Names and file
// paths only in the output, never a matched value.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const staticDir = join(root, '.next', 'static')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const PATTERNS: Array<[string, RegExp]> = [
  ['OpenAI key (sk-…)', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['Clerk secret key (sk_live/sk_test)', /\bsk_(?:live|test)_[A-Za-z0-9]{20,}/],
  ['Supabase secret key (sb_secret_)', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['Google API key (AIza…)', /\bAIza[0-9A-Za-z_-]{35}\b/],
]

const SERVER_KEYS = ['SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'GuideBuoy_EdgeFunction', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'CLERK_SECRET_KEY']

// A JWT whose payload says role service_role.
function serviceRoleJwt(text: string): boolean {
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { role?: string }
      if (payload.role === 'service_role') return true
    } catch {
      // not a JWT payload
    }
  }
  return false
}

export function bundleFindings(fileTexts: Array<[string, string]>, env: Record<string, string | undefined>): string[] {
  const findings: string[] = []
  const literals = SERVER_KEYS.map((name) => [name, env[name]?.trim()] as const).filter(([, v]) => v && v.length >= 16 && !/placeholder/i.test(v))
  for (const [path, text] of fileTexts) {
    for (const [label, pattern] of PATTERNS) if (pattern.test(text)) findings.push(`${label} in ${path}`)
    if (serviceRoleJwt(text)) findings.push(`service_role JWT in ${path}`)
    for (const [name, value] of literals) if (text.includes(value!)) findings.push(`value of ${name} in ${path}`)
  }
  return findings
}

const SECRET_NAME = /OPENAI|GEMINI|GOOGLE_GENERATIVE|SECRET|SERVICE_ROLE/

export function publicNameFindings(sourceTexts: string[]): string[] {
  const names = new Set(sourceTexts.flatMap((t) => [...t.matchAll(/\bNEXT_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0])))
  return [...names].filter((n) => SECRET_NAME.test(n)).map((n) => `NEXT_PUBLIC_ variable looks like a server secret: ${n}`)
}

if (process.argv[1]?.endsWith('check-client-bundle.mts')) {
  let bundle: string[]
  try {
    bundle = files(staticDir).filter((p) => /\.(js|mjs|css|json|html|txt)$/.test(p))
  } catch {
    console.error('check-client-bundle: .next/static not found; run the production build first')
    process.exit(1)
  }
  const sources = ['app', 'lib', 'components', 'hooks'].flatMap((d) => {
    try {
      return files(join(root, d)).filter((p) => /\.(ts|tsx)$/.test(p))
    } catch {
      return []
    }
  })
  const findings = [
    ...bundleFindings(bundle.map((p) => [relative(root, p), readFileSync(p, 'utf8')]), process.env),
    ...publicNameFindings(sources.map((p) => readFileSync(p, 'utf8'))),
  ]
  if (findings.length) {
    for (const f of findings) console.error(`FAIL ${f}`)
    process.exit(1)
  }
  console.log(`check-client-bundle: ${bundle.length} client files scanned, no server secret found`)
}
