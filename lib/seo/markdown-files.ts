import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { MARKDOWN_OUTPUT_DIR } from './public-routes.mjs'

// The files scripts/build-markdown-copies.mjs writes after `next build` (Addendum M). Missing in `next dev`, where
// callers fall back to what they can say without them.
export type MarkdownManifestEntry = { name: string; route: string; title: string; description: string; url: string; tokens: number }

export async function readMarkdownFile(file: string): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), MARKDOWN_OUTPUT_DIR, file), 'utf8')
  } catch {
    return null
  }
}

export async function readMarkdownManifest(): Promise<MarkdownManifestEntry[]> {
  const raw = await readMarkdownFile('manifest.json')
  return raw ? (JSON.parse(raw) as MarkdownManifestEntry[]) : []
}
