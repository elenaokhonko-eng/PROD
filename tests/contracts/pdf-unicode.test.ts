import assert from 'node:assert/strict'
import test from 'node:test'
import 'regenerator-runtime/runtime'
import fontkit from '@pdf-lib/fontkit'
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { buildFreeEvaluationPdf } from '../../lib/server/facts/free-evaluation-pdf'
import { fontRuns, unprintable } from '../../lib/server/pdf-fonts'

// Elena, 9 Nov: names and symbols print as written in the PDF, not as "?". Synthetic text only.
const CHINESE = '陈伟明 我在2026年10月3日收到一条短信，说我的银行账户被冻结。'
const TAMIL = 'ராஜேஷ் குமார் · கொ கோ கை கு கூ க்ஷ ஸ்ரீ'
const LATIN = 'Nur Aisyah binte Ahmad · “curly quotes” and ‘single’ ones · S$1,234.56 · €5 — café'

test('Chinese, Tamil, "·" and curly quotes all have a font; only characters no font has print as "?"', () => {
  assert.deepEqual(unprintable(CHINESE + TAMIL + LATIN), [])
  assert.deepEqual(unprintable('🙂'), ['🙂'])
  const runs = fontRuns(`${LATIN} ${CHINESE} ${TAMIL} 🙂`)
  assert.deepEqual([...new Set(runs.map((r) => r.file))].sort(), ['NotoSans-Regular.ttf', 'NotoSansSC-Regular.ttf', 'NotoSansTamil-Regular.ttf'])
  assert.equal(runs.map((r) => r.text).join(''), `${LATIN} ${CHINESE} ${TAMIL} ?`, 'text is kept in order; only the emoji is replaced')
  // A Tamil vowel sign stays in the same run as its consonant, so it is shaped with it.
  assert.ok(fontRuns('கொ').every((r) => r.file === 'NotoSansTamil-Regular.ttf'))
  assert.ok(fontRuns('Heading · 陈', 'bold').some((r) => r.file === 'NotoSans-Bold.ttf'))
})

test('the free-evaluation PDF embeds subset Unicode fonts whose glyphs all have outlines', async () => {
  const bytes = await buildFreeEvaluationPdf([
    { narrative_type: 'tier0_summary', title: 'Free evaluation summary', text_content: `${LATIN}\n${CHINESE.repeat(4)}\n${TAMIL}`, created_at: '2026-11-09T00:00:00Z' },
    { narrative_type: 'tier0_confirmed_facts', title: 'What you told us · 陈 · ராஜேஷ்', text_content: 'Line one', created_at: '2026-11-09T00:00:00Z' },
  ])
  assert.ok(bytes.length < 200_000, `fonts are subset (PDF is ${bytes.length} bytes)`)

  const doc = await PDFDocument.load(bytes)
  const embedded = new Map<string, Uint8Array>()
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor')) continue
    const name = object.get(PDFName.of('FontName'))!.toString().replace(/^\/[A-Z]{6}\+/, '/').slice(1)
    const file = object.lookup(PDFName.of('FontFile2'))
    assert.ok(file instanceof PDFRawStream, `${name} is embedded as a TrueType font file`)
    embedded.set(name.replace(/-\d+$/, ''), decodePDFRawStream(file).decode())
  }
  assert.deepEqual([...embedded.keys()].sort(), ['NotoSans-Bold', 'NotoSans-Regular', 'NotoSansSC-Regular', 'NotoSansTamil-Bold', 'NotoSansTamil-Regular'])
  assert.ok(![...doc.context.enumerateIndirectObjects()].some(([, o]) => o instanceof PDFDict && /Helvetica/.test(String(o.get(PDFName.of('BaseFont'))))), 'no standard Helvetica')

  for (const [name, data] of embedded) {
    const font = fontkit.create(data)
    assert.ok(font.numGlyphs > 1, `${name} has glyphs`)
    // Subsets carry no character map, so the space cannot be named: at most one glyph (the space) may be empty. A broken
    // subset (the CFF .otf, or unpadded glyphs) loses the outlines of most glyphs.
    const empty = Array.from({ length: font.numGlyphs - 1 }, (_, i) => i + 1).filter((id) => font.getGlyph(id).path.toSVG() === "")
    assert.ok(empty.length <= 1, `${name}: ${empty.length} of ${font.numGlyphs - 1} glyphs have no outline`)
  }
})
