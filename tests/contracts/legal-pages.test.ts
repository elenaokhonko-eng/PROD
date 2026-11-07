import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { LEGAL_FILES, loadLegalDocument, type Inline, type LegalBlock } from '../../lib/legal/legal-document'

// Finding F: the Terms and the Privacy Policy are shown exactly as written in docs/legal, version 2.0.

const words = (text: string) => text.split(/\s+/).filter(Boolean)
const inlineText = (inlines: Inline[]) => inlines.map((inline) => inline.text).join('')

function blockWords(block: LegalBlock): string[] {
  switch (block.kind) {
    case 'heading':
      return words(block.text)
    case 'paragraph':
      return words(inlineText(block.inlines))
    case 'list':
      return block.items.flatMap((item) => words(inlineText(item)))
    case 'table':
      return [...block.header, ...block.rows.flat()].flatMap((cell) => words(inlineText(cell)))
  }
}

// The source with only Markdown syntax removed: header, "#", "- ", "**", table pipes and the table rule line.
function sourceWords(path: string): string[] {
  const body = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '')
  return words(
    body
      .split('\n')
      .filter((line) => !/^\|[\s|:-]+\|$/.test(line))
      .map((line) => line.replace(/^#{1,2} |^- /, '').replace(/\|/g, ' ').replace(/\*\*/g, ''))
      .join('\n'),
  )
}

for (const name of Object.keys(LEGAL_FILES) as Array<keyof typeof LEGAL_FILES>) {
  test(`F: the ${name} page shows every word of ${LEGAL_FILES[name]}, in order, with nothing added`, () => {
    const document = loadLegalDocument(name)
    assert.deepEqual(document.blocks.flatMap(blockWords), sourceWords(LEGAL_FILES[name]))
    const tablesInSource = readFileSync(LEGAL_FILES[name], 'utf8').split(/\r?\n/).filter((line) => /^\|[\s|:-]+\|$/.test(line)).length
    assert.equal(document.blocks.filter((b) => b.kind === 'table').length, tablesInSource, 'every table is shown as a table')
  })

  test(`F: the ${name} header is the single source of its title, version and effective date`, () => {
    const { meta, blocks } = loadLegalDocument(name)
    assert.equal(meta.version, '2.0')
    assert.equal(meta.contact, 'info@guidebuoyai.sg')
    assert.deepEqual(blocks[0], { kind: 'heading', level: 1, text: meta.title })
    const replaces = meta.replaces.replace(/^(\S+) \((.*)\)$/, '$1 of $2')
    assert.deepEqual(blocks[1], {
      kind: 'paragraph',
      inlines: [{ text: `Version ${meta.version} · Effective ${meta.effective} · Replaces version ${replaces}`, bold: true }],
    }, 'the version line in the text must agree with the header (update both at cutover)')
  })

  test(`F: the ${name} page renders the document and nothing else`, () => {
    const page = readFileSync(`app/(marketing)/${name}/page.tsx`, 'utf8')
    assert.match(page, new RegExp(`<LegalDocumentPage document=\\{loadLegalDocument\\('${name}'\\)\\} />`))
  })
}

test('F: no privacy@ address anywhere users can see it', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      return statSync(path).isDirectory() ? files(path) : /\.(tsx?|md)$/.test(entry) ? [path] : []
    })
  const offenders = ['app', 'components', 'lib', 'supabase/functions', 'docs/legal'].flatMap(files).filter((path) => /privacy@/i.test(readFileSync(path, 'utf8')))
  assert.deepEqual(offenders, [])
})
