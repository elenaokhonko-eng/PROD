import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Brief W1 Addendum S4: fail the build if a secret reaches the browser bundle, the public folder or a new commit.
// Reports the kind of secret and where it is, never the value.
//
//   pnpm exec tsx scripts/scan-secrets.ts bundle         .next/static after `pnpm build`
//   pnpm exec tsx scripts/scan-secrets.ts public         files under public/
//   pnpm exec tsx scripts/scan-secrets.ts diff <base>    lines added since <base> (pull requests)

export const SECRET_PATTERNS: Record<string, RegExp> = {
  'Stripe secret or restricted key': /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/,
  'Stripe or Svix webhook secret': /\bwhsec_[A-Za-z0-9+/=]{20,}/,
  'Clerk secret key': /\bsk_(?:live|test)_[A-Za-z0-9]{20,}/,
  'OpenAI key': /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
  'Anthropic key': /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  'Google API key': /\bAIza[0-9A-Za-z_-]{35}\b/,
  'Supabase secret key': /\bsb_secret_[A-Za-z0-9_-]{20,}/,
  'Supabase service_role JWT': /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*(?:c2VydmljZV9yb2xl|InNlcnZpY2Vfcm9sZS)[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{10,}/,
  'GitHub token': /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/,
  'Render API key': /\brnd_[A-Za-z0-9]{20,}/,
  'Private key': /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/,
  'AWS access key': /\bAKIA[0-9A-Z]{16}\b/,
}

// Test fixtures that look like secrets on purpose (detectors and redaction are tested with them).
const FIXTURE = /ABCDE|abcde|x{6,}|X{6,}|example|placeholder|dummy|fake|redacted|\.\.\./

const FORBIDDEN_PUBLIC_FILE = /(^|\/)\.env|\.(pem|key|p12|pfx|bak|swp|map|sql|log|tfstate|ya?ml|toml)$|(^|\/)(id_rsa|credentials|service-?account)/i

export function findSecrets(text: string): string[] {
  const kinds: string[] = []
  for (const line of text.split('\n')) {
    for (const [kind, pattern] of Object.entries(SECRET_PATTERNS)) {
      const match = pattern.exec(line)
      if (match && !FIXTURE.test(match[0])) kinds.push(kind)
    }
  }
  return kinds
}

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    : []

function scanBundle(): string[] {
  const files = walk('.next/static').filter((path) => /\.(js|json|css|html|txt|map)$/.test(path))
  if (!files.length) return ['.next/static is empty: run `pnpm build` first']
  const findings = files.flatMap((path) => findSecrets(readFileSync(path, 'utf8')).map((kind) => `${kind} in ${relative('.', path)}`))
  const maps = files.filter((path) => path.endsWith('.map'))
  return [...findings, ...maps.map((path) => `source map served publicly: ${relative('.', path)}`)]
}

function scanPublic(): string[] {
  return walk('public').flatMap((path) => {
    const name = relative('public', path).replace(/\\/g, '/')
    const findings = FORBIDDEN_PUBLIC_FILE.test(name) ? [`file that must not be public: public/${name}`] : []
    if (/\.(txt|json|js|html|xml|md|svg)$/.test(name)) {
      findings.push(...findSecrets(readFileSync(path, 'utf8')).map((kind) => `${kind} in public/${name}`))
    }
    return findings
  })
}

function scanDiff(base: string): string[] {
  const diff = execFileSync('git', ['diff', '--unified=0', '--no-color', base, 'HEAD'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const findings: string[] = []
  let file = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) file = line.slice(6)
    else if (line.startsWith('+') && !line.startsWith('+++')) findings.push(...findSecrets(line.slice(1)).map((kind) => `${kind} added in ${file}`))
  }
  return findings
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const modes: string[] = []
  const findings: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const mode = args[i]
    modes.push(mode)
    if (mode === 'bundle') findings.push(...scanBundle())
    else if (mode === 'public') findings.push(...scanPublic())
    else if (mode === 'diff') findings.push(...scanDiff(args[++i] ?? 'origin/main'))
    else {
      console.error(`Unknown mode: ${mode}`)
      process.exit(2)
    }
  }
  if (!modes.length) {
    console.error('Usage: scan-secrets.ts bundle | public | diff <base>')
    process.exit(2)
  }
  if (findings.length) {
    console.error(`Secret scan failed (${findings.length}):\n${[...new Set(findings)].map((f) => `- ${f}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`Secret scan passed: ${modes.join(', ')}`)
}
