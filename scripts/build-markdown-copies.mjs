// Addendum M §M1–M2: after `next build`, turn the <main> of each indexable page's prerendered HTML into a markdown copy,
// so the copy and the page come from the same source and cannot drift. Fails the build when a heading, price or FAQ
// question differs between the two (§M6.1). Run by `pnpm build`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { MARKDOWN_COPIES, MARKDOWN_OUTPUT_DIR } from '../lib/seo/public-routes.mjs'

const SITE_ORIGIN = 'https://guidebuoyai.sg'
const STORY_LINE = `Start your free evaluation at ${SITE_ORIGIN}/#tell-your-story`
const appDir = path.join('.next', 'server', 'app')

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))
    return ENTITIES[code.toLowerCase()] ?? whole
  })
const plain = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const attr = (html, pattern) => decode(html.match(pattern)?.[1] ?? '')

const hasClass = (node, name) => (node.getAttribute?.('class') ?? '').split(/\s+/).includes(name)
const absolute = (href, route) => {
  if (!href) return href
  if (href.startsWith('#')) return `${SITE_ORIGIN}${route === '/' ? '/' : route}${href}`
  if (href.startsWith('/')) return `${SITE_ORIGIN}${href}`
  return href
}

function converter(route) {
  const service = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' })
  service.use(gfm)
  // §M2: no scripts, controls, navigation or text meant only for screen readers.
  service.remove(['script', 'style', 'noscript', 'svg', 'input', 'select', 'template', 'nav', 'label'])
  // A button is a control, except the FAQ's question buttons, which are the text of their heading.
  service.addRule('controls', {
    filter: (node) => node.nodeName === 'BUTTON',
    replacement: (content, node) => (/^H[1-6]$/.test(node.parentNode?.nodeName ?? '') ? content : ''),
  })
  service.addRule('hidden-from-readers', {
    filter: (node) => node.getAttribute?.('aria-hidden') === 'true' || hasClass(node, 'sr-only'),
    replacement: () => '',
  })
  // §M2: an interactive part becomes one line that says where to use it.
  // The story box is an empty <textarea>, which Turndown drops before any rule sees it; see storyBoxAsLine below.
  service.addRule('story-form', { filter: 'form', replacement: () => `\n\n${STORY_LINE}\n\n` })
  service.addRule('absolute-links', {
    filter: (node) => node.nodeName === 'A' && Boolean(node.getAttribute('href')),
    replacement: (content, node) => {
      const text = content.trim()
      return text ? `[${text}](${absolute(node.getAttribute('href'), route)})` : ''
    },
  })
  service.addRule('images-as-alt-text', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = (node.getAttribute('alt') ?? '').trim()
      return alt ? `${alt}` : ''
    },
  })
  return service
}

const headingsFromHtml = (html) =>
  [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => match[2].replace(/<(\w+)[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ''))
    .map(plain)
    .filter(Boolean)
const headingsFromMarkdown = (markdown) =>
  // A heading inside a list item comes out as "1. ### Step".
  [...markdown.matchAll(/^[ \t]*(?:(?:[-*]|\d+\.)[ \t]+)?#{1,6}[ \t]+(.+)$/gm)].map((match) => match[1].replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
const prices = (text) => [...new Set(text.match(/S\$\s?\d+(?:\.\d{2})?/g) ?? [])].sort()

const failures = []
const manifest = []
mkdirSync(MARKDOWN_OUTPUT_DIR, { recursive: true })
const lastUpdated = new Date().toISOString().slice(0, 10)

for (const { name, route } of MARKDOWN_COPIES) {
  const file = path.join(appDir, `${name}.html`)
  const html = readFileSync(file, 'utf8')
  const start = html.indexOf('<main')
  const end = html.lastIndexOf('</main>')
  if (start === -1 || end === -1) {
    failures.push(`${route}: no <main> in ${file}`)
    continue
  }
  const main = html
    .slice(start, end + '</main>'.length)
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<textarea\b[\s\S]*?<\/textarea>/gi, `<p>${STORY_LINE}</p>`)
  const title = attr(html, /<title>([\s\S]*?)<\/title>/i)
  const description = attr(html, /<meta name="description" content="([^"]*)"/i)
  const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/i) || `${SITE_ORIGIN}${route}`

  const body = converter(route)
    .turndown(main)
    .replace(/^[ \t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const frontMatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `url: ${JSON.stringify(canonical)}`,
    `last_updated: ${JSON.stringify(lastUpdated)}`,
    '---',
  ].join('\n')
  const markdown = `${frontMatter}\n\n${body}\n`

  // §M6.1 parity: the same headings (FAQ questions are headings) and the same prices on both sides.
  const htmlHeadings = headingsFromHtml(main)
  const mdHeadings = headingsFromMarkdown(body)
  const missing = htmlHeadings.filter((heading) => !mdHeadings.includes(heading))
  const extra = mdHeadings.filter((heading) => !htmlHeadings.includes(heading))
  if (missing.length || extra.length) failures.push(`${route}: headings differ; only in HTML: ${JSON.stringify(missing)}; only in markdown: ${JSON.stringify(extra)}`)
  const htmlPrices = prices(plain(main))
  const mdPrices = prices(body)
  if (htmlPrices.join() !== mdPrices.join()) failures.push(`${route}: prices differ; HTML ${htmlPrices.join(' ')}, markdown ${mdPrices.join(' ')}`)

  writeFileSync(path.join(MARKDOWN_OUTPUT_DIR, `${name}.md`), markdown)
  manifest.push({
    name,
    route,
    title,
    description,
    url: canonical,
    body,
    tokens: Math.ceil(markdown.length / 4),
    markdownBytes: Buffer.byteLength(markdown),
    htmlBytes: Buffer.byteLength(html),
  })
}

// §M5: /llms-full.txt is every copy in menu order, each under its page title and address.
const full = manifest.map((entry) => `# ${entry.title}\n\nURL: ${entry.url}\n\n${entry.body}\n`).join('\n---\n\n')
writeFileSync(path.join(MARKDOWN_OUTPUT_DIR, 'llms-full.txt'), full)
writeFileSync(
  path.join(MARKDOWN_OUTPUT_DIR, 'manifest.json'),
  `${JSON.stringify(manifest.map(({ body: _body, ...entry }) => entry), null, 2)}\n`,
)
if (failures.length) {
  console.error(`Markdown copies do not match their pages (Addendum M §M6.1):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(`Markdown copies: ${manifest.map((entry) => `${entry.name} ${entry.markdownBytes}/${entry.htmlBytes} bytes`).join(', ')}`)
