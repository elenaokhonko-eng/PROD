import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The Terms and the Privacy Policy are published exactly as written in docs/legal (finding F). This reads the small
// Markdown subset those files use: a front-matter header, headings, paragraphs, bullet lists, tables and **bold**.

export type LegalMeta = { title: string; version: string; effective: string; replaces: string; contact: string }

export type Inline = { text: string; bold: boolean }

export type LegalBlock =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }

export type LegalDocument = { meta: LegalMeta; blocks: LegalBlock[] }

export const LEGAL_FILES = {
  terms: 'docs/legal/terms-of-service.md',
  privacy: 'docs/legal/privacy-policy.md',
} as const

export function inlines(text: string): Inline[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }))
}

function parseMeta(header: string): LegalMeta {
  const fields = new Map<string, string>()
  for (const line of header.split('\n')) {
    const match = /^(\w+):\s*(.*)$/.exec(line.trim())
    if (match) fields.set(match[1], match[2].replace(/^"(.*)"$/, '$1'))
  }
  const field = (key: keyof LegalMeta) => {
    const value = fields.get(key)
    if (!value) throw new Error(`Legal document header is missing "${key}"`)
    return value
  }
  return { title: field('title'), version: field('version'), effective: field('effective'), replaces: field('replaces'), contact: field('contact') }
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inlines(cell.trim()))

export function parseLegalDocument(source: string): LegalDocument {
  const text = source.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match) throw new Error('Legal document has no front-matter header')
  const blocks: LegalBlock[] = []
  for (const chunk of text.slice(match[0].length).split(/\n{2,}/)) {
    const lines = chunk.trim().split('\n')
    if (!lines[0]) continue
    const heading = /^(#{1,2}) (.*)$/.exec(lines[0])
    if (heading && lines.length === 1) blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2, text: heading[2] })
    else if (lines.every((line) => line.startsWith('- '))) blocks.push({ kind: 'list', items: lines.map((line) => inlines(line.slice(2))) })
    else if (lines.every((line) => line.startsWith('|')) && /^\|[\s|:-]+\|$/.test(lines[1] ?? '')) {
      blocks.push({ kind: 'table', header: cells(lines[0]), rows: lines.slice(2).map(cells) })
    } else if (lines.some((line) => /^(#|- |\|)/.test(line))) throw new Error(`Unsupported Markdown in legal document: ${lines[0]}`)
    else blocks.push({ kind: 'paragraph', inlines: inlines(lines.join(' ')) })
  }
  return { meta: parseMeta(match[1]), blocks }
}

export function loadLegalDocument(name: keyof typeof LEGAL_FILES): LegalDocument {
  return parseLegalDocument(readFileSync(join(process.cwd(), LEGAL_FILES[name]), 'utf8'))
}
