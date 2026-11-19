import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Brief W1 §O: the guides that exist and which are published, read from content/guides when the site is built. Plain
// JavaScript so next.config.mjs and lib/seo/public-routes.mjs (the sitemap, llms.txt and markdown copies) can use it.
// lib/guides/guides.ts parses and checks each guide fully; this reads only the slug, title and status.

export const GUIDES_DIR = 'content/guides'

/** @param {string} source */
export function frontMatterField(source, key) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? ''
  const line = header.split(/\r?\n/).find((entry) => entry.startsWith(`${key}:`))
  return line ? line.slice(key.length + 1).trim().replace(/^"(.*)"$/, '$1') : ''
}

/** Every guide file, as { slug, title, status }. @param {string} [dir] */
export function guideFiles(dir = GUIDES_DIR) {
  const root = join(process.cwd(), dir)
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const source = readFileSync(join(root, name), 'utf8')
      return { slug: name.slice(0, -'.md'.length), title: frontMatterField(source, 'title'), status: frontMatterField(source, 'status') }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Published guides only: the only ones that are routable, listed, in the sitemap and in llms.txt. @param {string} [dir] */
export const publishedGuideFiles = (dir) => guideFiles(dir).filter((guide) => guide.status === 'published')
