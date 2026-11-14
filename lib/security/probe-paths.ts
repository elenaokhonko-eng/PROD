// Brief W1 Addendum S: requests that scan for leaked secrets, config files and admin consoles. The same rule runs at
// Cloudflare's edge (S1, CLOUDFLARE_PROBE_RULE below) and here in the app (S2), so a probe that reaches the origin
// directly still gets a 9-byte 404 before Clerk, Supabase or any page render runs.
//
// Keep the two in step: isProbe() implements the Cloudflare expression term for term.

const BLOCKED_EXTENSIONS = ['.php', '.yml', '.yaml', '.toml', '.tfstate', '.log', '.sql', '.key', '.pem', '.bak', '.swp', '.save']

const BLOCKED_EXACT = new Set([
  '/Dockerfile', '/turbo.json', '/rush.json', '/key.json', '/gcp-key.json', '/serviceAccountKey.json',
  '/google-service-account.json', '/firebase-credentials.json', '/firebase-adminsdk.json', '/credentials.js', '/__env.js',
  '/push_config.json', '/config.json', '/package.json', '/next.config.js', '/next.config.mjs', '/nuxt.config.ts',
  '/server-info', '/server-status', '/console', '/wp-json', '/admin/api-tokens', '/api/settings', '/api/v1/settings',
  '/api/v1/keys', '/api/v1/secrets', '/api/env', '/api/console/api_server', '/dashboard/_payload.json',
  '/v1/onboarding/config',
])

const BLOCKED_PREFIXES = [
  '/actuator', '/_ignition', '/_debugbar', '/telescope', '/graphql', '/litellm', '/nacos', '/wp-', '/storage/',
  '/userfiles', '/config/', '/ssl/',
]

/**
 * `path` is the request path exactly as received (still percent-encoded); `uri` is path plus query, as Cloudflare's
 * `http.request.uri`.
 */
export function isProbe(path: string, uri: string = path): boolean {
  const lowerPath = path.toLowerCase()
  return (
    (path.includes('/.') && !path.startsWith('/.well-known/')) ||
    path.includes('.env') ||
    path.includes('..') ||
    uri.toLowerCase().includes('%2e%2e') ||
    lowerPath.includes('%2f') ||
    lowerPath.includes('%5c') ||
    path.includes('/proc/self') ||
    BLOCKED_EXTENSIONS.some((extension) => lowerPath.endsWith(extension)) ||
    BLOCKED_EXACT.has(path) ||
    BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

const quoted = (values: Iterable<string>) => [...values].map((value) => `"${value}"`).join(' ')

// The Cloudflare custom rule (Security → WAF → Custom rules, action Block), generated from the same lists so the edge
// and the app cannot drift apart. Print it with: pnpm exec tsx scripts/print-probe-rule.ts
export const CLOUDFLARE_PROBE_RULE = [
  '(http.request.uri.path contains "/." and not starts_with(http.request.uri.path, "/.well-known/"))',
  'or (http.request.uri.path contains ".env")',
  'or (http.request.uri.path contains "..")',
  'or (lower(http.request.uri) contains "%2e%2e")',
  'or (lower(http.request.uri.path) contains "%2f")',
  'or (lower(http.request.uri.path) contains "%5c")',
  'or (http.request.uri.path contains "/proc/self")',
  ...BLOCKED_EXTENSIONS.map((extension) => `or ends_with(lower(http.request.uri.path), "${extension}")`),
  `or (http.request.uri.path in {${quoted(BLOCKED_EXACT)}})`,
  ...BLOCKED_PREFIXES.map((prefix) => `or starts_with(http.request.uri.path, "${prefix}")`),
].join('\n')
