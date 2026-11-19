import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACK_ACTION, packHref, type PaidPack } from '@/lib/harbor/packs'
import { BANK_HOTLINES } from '@/lib/resources/official-help'
import { GUIDES_DIR, guideFiles } from './guide-files.mjs'

// Brief W1 §O: guides are Markdown files in content/guides with a front-matter header. The agent never writes guide
// content; it arrives through brief W2 after Elena's review. Only published guides are routable or listed, and a
// published guide without a reviewer, a review date and an official source stops the build.

export const GUIDE_STAGES = ['just-happened', 'reported', 'final-reply', 'fidrec', 'general'] as const
export type GuideStage = (typeof GUIDE_STAGES)[number]

export const STAGE_TITLES: Record<GuideStage, string> = {
  'just-happened': 'Just happened',
  reported: 'Reported to the bank',
  'final-reply': 'Bank gave its final reply',
  fidrec: 'At FIDReC',
  general: 'General',
}

export type GuideInline = { text: string; bold?: boolean; href?: string }
export type GuideBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; inlines: GuideInline[] }
  | { kind: 'list'; ordered: boolean; items: GuideInline[][] }

export type GuideSource = { label: string; url: string }

export type Guide = {
  slug: string
  title: string
  description: string
  question: string
  answer: string
  stage: GuideStage
  reviewedBy: string
  reviewedOn: string
  sources: GuideSource[]
  status: 'draft' | 'published'
  blocks: GuideBlock[]
}

// Official sources: Singapore government sites, FIDReC, and the banks' own sites listed on Resources.
const OFFICIAL_HOSTS = ['fidrec.com.sg', ...BANK_HOTLINES.map((line) => new URL(line.sourceUrl).hostname.replace(/^www\./, ''))]

export function isOfficialSource(url: string): boolean {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    host = parsed.hostname.toLowerCase()
  } catch {
    return false
  }
  return host.endsWith('.gov.sg') || OFFICIAL_HOSTS.some((official) => host === official || host.endsWith(`.${official}`))
}

// **bold** and [text](https://… or /path).
export function guideInlines(text: string): GuideInline[] {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https:\/\/|\/)[^)\s]+\))/)
    .filter(Boolean)
    .map((part) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      if (link) return { text: link[1], href: link[2] }
      if (part.startsWith('**') && part.endsWith('**')) return { text: part.slice(2, -2), bold: true }
      return { text: part }
    })
}

function parseHeader(header: string) {
  const fields = new Map<string, string>()
  const sources: GuideSource[] = []
  let inSources = false
  for (const raw of header.split('\n')) {
    const line = raw.trimEnd()
    const field = /^(\w+):\s*(.*)$/.exec(line)
    if (field) {
      inSources = field[1] === 'sources'
      if (!inSources) fields.set(field[1], field[2].replace(/^"(.*)"$/, '$1'))
      continue
    }
    const source = /^\s+-\s+(.+?)\s+\|\s+(\S+)$/.exec(line)
    if (inSources && source) sources.push({ label: source[1], url: source[2] })
    else if (line.trim()) throw new Error(`Unreadable guide header line: ${line}`)
  }
  return { fields, sources }
}

function parseBody(body: string): GuideBlock[] {
  const blocks: GuideBlock[] = []
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.trim().split('\n')
    if (!lines[0]) continue
    const heading = /^(#{2,3}) (.*)$/.exec(lines[0])
    if (heading && lines.length === 1) blocks.push({ kind: 'heading', level: heading[1].length as 2 | 3, text: heading[2] })
    else if (lines.every((line) => line.startsWith('- '))) blocks.push({ kind: 'list', ordered: false, items: lines.map((line) => guideInlines(line.slice(2))) })
    else if (lines.every((line) => /^\d+\. /.test(line))) blocks.push({ kind: 'list', ordered: true, items: lines.map((line) => guideInlines(line.replace(/^\d+\. /, ''))) })
    else if (lines.some((line) => /^(#|- |\d+\. |\|)/.test(line))) throw new Error(`Unsupported Markdown in guide: ${lines[0]}`)
    else blocks.push({ kind: 'paragraph', inlines: guideInlines(lines.join(' ')) })
  }
  return blocks
}

export function parseGuide(slug: string, source: string): Guide {
  const text = source.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match) throw new Error(`Guide ${slug} has no front-matter header`)
  const { fields, sources } = parseHeader(match[1])
  const get = (key: string) => fields.get(key) ?? ''
  const stage = get('stage') as GuideStage
  const status = get('status')
  if (!GUIDE_STAGES.includes(stage)) throw new Error(`Guide ${slug}: stage must be one of ${GUIDE_STAGES.join(', ')}`)
  if (status !== 'draft' && status !== 'published') throw new Error(`Guide ${slug}: status must be draft or published`)
  return {
    slug,
    title: get('title'),
    description: get('description'),
    question: get('question'),
    answer: get('answer'),
    stage,
    reviewedBy: get('reviewed_by'),
    reviewedOn: get('reviewed_on'),
    sources,
    status,
    blocks: parseBody(text.slice(match[0].length)),
  }
}

// What a published guide must have; the build fails on any of these (brief W1 §O).
export function publishProblems(guide: Guide): string[] {
  const problems: string[] = []
  for (const [key, value] of [['title', guide.title], ['description', guide.description], ['question', guide.question], ['answer', guide.answer]] as const) {
    if (!value) problems.push(`${key} is empty`)
  }
  if (!guide.reviewedBy) problems.push('reviewed_by is empty')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(guide.reviewedOn)) problems.push('reviewed_on is not a date (YYYY-MM-DD)')
  if (!guide.sources.some((source) => isOfficialSource(source.url))) problems.push('no source on an official site')
  for (const source of guide.sources) if (!isOfficialSource(source.url)) problems.push(`source is not an official site: ${source.url}`)
  return problems
}

export function loadGuides(dir: string = GUIDES_DIR): Guide[] {
  return guideFiles(dir).map(({ slug }) => parseGuide(slug, readFileSync(join(process.cwd(), dir, `${slug}.md`), 'utf8')))
}

// The guides the site shows. Throws, and so fails the build, if a published guide is incomplete.
export function loadPublishedGuides(dir: string = GUIDES_DIR): Guide[] {
  const published = loadGuides(dir).filter((guide) => guide.status === 'published')
  const failures = published.flatMap((guide) => publishProblems(guide).map((problem) => `${guide.slug}: ${problem}`))
  if (failures.length) throw new Error(`Published guides are incomplete:\n${failures.join('\n')}`)
  return published.sort((a, b) => a.title.localeCompare(b.title))
}

export function formatReviewedOn(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// The pack a stage leads to (brief W1 §E3): before the bank's final reply the bank pack, after it the FIDReC pack.
const STAGE_PACK: Partial<Record<GuideStage, PaidPack>> = { reported: 'bank', 'final-reply': 'fidrec', fidrec: 'fidrec' }

// One call to action chosen by stage. While the packs are off, every guide leads to the free evaluation.
export function guideAction(stage: GuideStage, packsLive: boolean): { kind: 'evaluation' } | { kind: 'pack'; label: string; href: string } {
  const pack = STAGE_PACK[stage]
  return pack && packsLive ? { kind: 'pack', label: PACK_ACTION[pack], href: packHref(pack, true) } : { kind: 'evaluation' }
}
