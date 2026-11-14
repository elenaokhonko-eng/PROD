import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type PageRoute = { path: string; file: string; marketing: boolean; dynamic: boolean }

// Every page.tsx under app/, as its URL path. Route groups "(x)" drop out; dynamic segments are kept as written.
export function enumeratePageRoutes(appDir = join(process.cwd(), 'app')): PageRoute[] {
  const routes: PageRoute[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name === 'page.tsx') {
        const segments = relative(appDir, dir).split(sep).filter(Boolean)
        const urlSegments = segments.filter((s) => !/^\(.*\)$/.test(s))
        routes.push({
          path: '/' + urlSegments.join('/'),
          file: relative(process.cwd(), full),
          marketing: segments[0] === '(marketing)',
          dynamic: urlSegments.some((s) => s.startsWith('[') && !s.startsWith('[[')),
        })
      }
    }
  }
  walk(appDir)
  return routes
}

// The URL to request for a route whose only dynamic part is an optional catch-all, e.g. /sign-in/[[...sign-in]].
export function requestPath(route: PageRoute) {
  return route.path.replace(/\/\[\[[^\]]+\]\]$/, '') || '/'
}
