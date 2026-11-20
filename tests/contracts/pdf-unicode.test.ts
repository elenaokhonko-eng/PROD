import assert from 'node:assert/strict'
import test from 'node:test'
import 'regenerator-runtime/runtime'
import fontkit from '@pdf-lib/fontkit'
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { readFileSync } from 'node:fs'
import { buildBankPackPdf } from '../../lib/server/facts/bank-pack-pdf'
import { buildFidrecPackPdf } from '../../lib/server/facts/fidrec-pack-pdf'
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

test('the bank pack PDF prints accented and non-Latin names, with the paid notice and every section', async () => {
  const bytes = await buildBankPackPdf(
    {
      title: 'Complaint · Zoë Müller-Đặng',
      executive_summary: `${LATIN}\n${CHINESE}\n${TAMIL}`,
      timeline: [{ date: '2026-10-02', event: 'Payment of S$1,800 to José Peña' }, { event: 'I found out about the scam' }],
      disputed_transactions: [{ date: '2026-10-02', amount: 'S$1,800', paid_to: 'José Peña', method: 'FAST transfer' }],
      total_loss: 'S$1,800',
      rules_assessment: 'This is based only on the facts you confirmed.',
      requested_resolution: 'I ask the bank to review the disputed payments.',
      evidence_checklist: [{ label: 'Amount lost: S$1,800. No document yet.', present: false }],
    },
    '2026-11-20T00:00:00Z',
  )
  const doc = await PDFDocument.load(bytes)
  assert.ok(doc.getPageCount() >= 1)
  const fonts = [...doc.context.enumerateIndirectObjects()]
    .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
    .map(([, o]) => String((o as PDFDict).get(PDFName.of('FontName'))))
  assert.ok(fonts.some((f) => /NotoSansSC/.test(f)) && fonts.some((f) => /NotoSansTamil/.test(f)), 'Chinese and Tamil fonts are embedded')
  assert.deepEqual(unprintable(`Zoë Müller-Đặng José Peña ${LATIN}`), [])
  const source = readFileSync('lib/server/facts/bank-pack-pdf.ts', 'utf8')
  assert.match(source, /addParagraph\(PAID_PACK_NOTICE\)/)
  for (const heading of ['Executive summary', 'Timeline', 'Disputed transactions', 'How the rules may apply', 'Requested resolution', 'Evidence checklist']) {
    assert.ok(source.includes(`"${heading}"`), heading)
  }
})

test('the FIDReC pack PDF prints accented and non-Latin names, with the paid notice and both sides', async () => {
  const bytes = await buildFidrecPackPdf(
    {
      title: 'Complaint · Zoë Müller-Đặng',
      executive_summary: `${LATIN}\n${CHINESE}\n${TAMIL}`,
      route: 'If the case goes to adjudication, FIDReC charges individuals a S$50 case fee.',
      timeline: [{ date: '2026-08-02', event: 'Payment of S$3,000' }],
      claimant_position: 'The complainant, José Peña, asks FIDReC to review the payment.',
      institution_position: 'The institution declined the claim.',
      arguments_for_claimant: [{ text: 'Reported promptly.', evidence_ids: ['E1'] }],
      arguments_for_institution: [{ text: 'Own device.', evidence_ids: ['E1'] }],
      evidence_index: [{ id: 'E1', document: 'a letter or email from your bank (uploaded)' }],
    },
    '2026-11-21T00:00:00Z',
  )
  const doc = await PDFDocument.load(bytes)
  assert.ok(doc.getPageCount() >= 1)
  const source = readFileSync('lib/server/facts/fidrec-pack-pdf.ts', 'utf8')
  assert.match(source, /addParagraph\(PAID_PACK_NOTICE\)/)
  for (const heading of ['Executive summary', 'Filing with FIDReC', 'Chronology', 'The complainant’s position', 'The institution’s position', 'Points for the complainant', 'Points for the institution', 'Evidence index']) {
    assert.ok(source.includes(`"${heading}"`), heading)
  }
})
