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

// The effective date is the day the pages go public (cutover), not the day the text was approved (Elena, 9 Nov). The
// Markdown carries a placeholder; LEGAL_EFFECTIVE_DATE (YYYY-MM-DD) fills it when the pages are built. A production
// build without it stops, so the pages can never show a date before anyone could read them.
export const EFFECTIVE_PLACEHOLDER = '{{effective}}'
export const EFFECTIVE_UNSET = '(date set at launch)'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function legalEffectiveDate(env: Record<string, string | undefined> = process.env): string {
  const value = env.LEGAL_EFFECTIVE_DATE?.trim() ?? ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  if (date && date.getUTCDate() === Number(match![3]) && date.getUTCMonth() === Number(match![2]) - 1) {
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
  }
  if (env.HARBOR_DEPLOYMENT_ENVIRONMENT === 'production') {
    throw new Error(value ? 'LEGAL_EFFECTIVE_DATE must be a date (YYYY-MM-DD)' : 'LEGAL_EFFECTIVE_DATE is not set: production legal pages need their effective date')
  }
  return EFFECTIVE_UNSET
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inlines(cell.trim()))

export function parseLegalDocument(source: string, effective = legalEffectiveDate()): LegalDocument {
  const text = source.replace(/\r\n/g, '\n').split(EFFECTIVE_PLACEHOLDER).join(effective)
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
  const meta = parseMeta(match[1])
  // A version can't take effect before the one it replaces (staging showed v2.2 effective 10 Nov replacing v2.1 of
  // 14 Nov, 23 Nov 2026): the build stops until the date is set right.
  const replacedOn = /\((\d{1,2} \w+ \d{4})\)$/.exec(meta.replaces)?.[1]
  if (replacedOn && dayOf(meta.effective) !== null && dayOf(meta.effective)! < dayOf(replacedOn)!) {
    throw new Error(`${meta.title} v${meta.version} is effective ${meta.effective}, before version ${meta.replaces} it replaces: fix its effective date`)
  }
  return { meta, blocks }
}

function dayOf(date: string): number | null {
  const match = /^(\d{1,2}) (\w+) (\d{4})$/.exec(date)
  const month = match ? MONTHS.indexOf(match[2]) : -1
  return match && month >= 0 ? Date.UTC(Number(match[3]), month, Number(match[1])) : null
}

// Each document may take effect on its own day: LEGAL_EFFECTIVE_DATE_TERMS or LEGAL_EFFECTIVE_DATE_PRIVACY overrides
// the shared LEGAL_EFFECTIVE_DATE for that document only (Terms v2.2 followed Privacy v2.1, 14 Nov 2026).
export function documentEffectiveDate(name: keyof typeof LEGAL_FILES, env: Record<string, string | undefined> = process.env): string {
  const own = env[`LEGAL_EFFECTIVE_DATE_${name.toUpperCase()}`]?.trim()
  return legalEffectiveDate(own ? { ...env, LEGAL_EFFECTIVE_DATE: own } : env)
}

export function loadLegalDocument(name: keyof typeof LEGAL_FILES): LegalDocument {
  return parseLegalDocument(readFileSync(join(process.cwd(), LEGAL_FILES[name]), 'utf8'), documentEffectiveDate(name))
}
