import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { INDEXABLE_ROUTES } from '../lib/seo/public-routes.mjs'

// Brief W1 §L8: tell IndexNow search engines (Bing and others) which public pages changed in a production release.
// Run after the 5-minute production check:
//   pnpm exec tsx scripts/indexnow-submit.ts --from <previous production sha> --to <new sha> [--dry-run]
//   pnpm exec tsx scripts/indexnow-submit.ts --all [--dry-run]
// Only indexable public pages are ever submitted; account and API routes are refused.

const SITE = 'https://guidebuoyai.sg'
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const indexable: readonly string[] = INDEXABLE_ROUTES

// The key file at the site root (public by design: it proves the site's owner sent the submission).
export function indexNowKey(dir = 'public'): string {
  const files = readdirSync(dir).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name))
  if (files.length !== 1) throw new Error(`Expected one IndexNow key file in ${dir}, found ${files.length}.`)
  const key = files[0].replace(/\.txt$/, '')
  if (readFileSync(`${dir}/${files[0]}`, 'utf8').trim() !== key) throw new Error('The IndexNow key file does not contain its own key.')
  return key
}

// Which public pages a set of changed files affects. Shared code (layout, components, lib) affects every page.
export function routesForChangedFiles(files: readonly string[]): string[] {
  const routes = new Set<string>()
  for (const file of files.map((f) => f.replace(/\\/g, '/'))) {
    const page = file.match(/^app\/\(marketing\)\/(?:([^/]+)\/)?(?:page|opengraph-image)\.tsx$/)
    if (page) {
      routes.add(page[1] ? `/${page[1]}` : '/')
    } else if (file === 'docs/legal/terms-of-service.md') {
      routes.add('/terms')
    } else if (file === 'docs/legal/privacy-policy.md') {
      routes.add('/privacy')
    } else if (/^(app\/\(marketing\)\/layout\.tsx|components\/|lib\/)/.test(file)) {
      indexable.forEach((route) => routes.add(route))
    }
  }
  return [...routes].filter((route) => indexable.includes(route)).sort()
}

// The request body. Refuses anything that is not an indexable public page.
export function submission(routes: readonly string[], key: string) {
  for (const route of routes) {
    if (!indexable.includes(route)) throw new Error(`Refusing to submit ${route}: not an indexable public page.`)
  }
  return {
    host: new URL(SITE).host,
    key,
    keyLocation: `${SITE}/${key}.txt`,
    urlList: routes.map((route) => `${SITE}${route === '/' ? '/' : route}`),
  }
}

async function main(args: string[]) {
  const dryRun = args.includes('--dry-run')
  let routes: string[]
  if (args.includes('--all')) {
    routes = [...indexable]
  } else {
    const from = args[args.indexOf('--from') + 1]
    const to = args[args.indexOf('--to') + 1]
    if (!args.includes('--from') || !args.includes('--to') || !from || !to) throw new Error('Pass --all, or --from <sha> --to <sha>.')
    const files = execFileSync('git', ['diff', '--name-only', `${from}..${to}`], { encoding: 'utf8' }).split('\n').filter(Boolean)
    routes = routesForChangedFiles(files)
  }
  if (routes.length === 0) {
    console.log('No public pages changed; nothing to submit.')
    return
  }
  const body = submission(routes, indexNowKey())
  console.log(`Submitting ${body.urlList.length} page(s):\n${body.urlList.join('\n')}`)
  if (dryRun) return
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  // 200 accepted, 202 accepted pending key check; anything else is a failure to report.
  console.log(`IndexNow answered HTTP ${response.status}.`)
  if (response.status !== 200 && response.status !== 202) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
