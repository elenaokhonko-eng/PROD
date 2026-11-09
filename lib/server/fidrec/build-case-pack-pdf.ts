import { PDFDocument, rgb } from "pdf-lib"
import { PdfFonts, type FontWeight } from "@/lib/server/pdf-fonts"
import { AUTOMATED_OUTPUT_NOTICE } from "@/lib/legal/automated-output-notice"
import type { FidrecSubmissionPack } from "@/lib/types/fidrec-case-pack"

const MARGIN = 50
const LINE_HEIGHT = 14
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2

type Measure = (text: string) => Promise<number>

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" })

// Breaks at spaces; a word wider than the line (a Chinese sentence has no spaces) breaks between characters. Each word
// is measured once and line widths are summed, so a long paragraph is not re-measured word by word.
async function wrapLine(text: string, measure: Measure, maxWidth: number): Promise<string[]> {
  const space = await measure(" ")
  const lines: string[] = []
  let current = ""
  let width = 0
  for (const word of text.split(" ")) {
    const wordWidth = await measure(word)
    if (current && width + space + wordWidth <= maxWidth) {
      current += ` ${word}`
      width += space + wordWidth
      continue
    }
    if (current) lines.push(current)
    if (wordWidth <= maxWidth) {
      current = word
      width = wordWidth
      continue
    }
    current = ""
    width = 0
    for (const { segment } of graphemes.segment(word)) {
      const segmentWidth = await measure(segment)
      if (current && width + segmentWidth > maxWidth) {
        lines.push(current)
        current = ""
        width = 0
      }
      current += segment
      width += segmentWidth
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [text]
}

async function wrapParagraph(text: string, measure: Measure, maxWidth: number): Promise<string[]> {
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") lines.push("")
    else lines.push(...(await wrapLine(paragraph, measure, maxWidth)))
  }
  return lines
}

export class PdfBuilder {
  private doc = PDFDocument.create()
  private fonts: PdfFonts | null = null
  private page: any = null
  private y = 0

  async init() {
    const doc = await this.doc
    this.fonts = new PdfFonts(doc)
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
  }

  private get docInstance() {
    return this.page.doc
  }

  private ensureSpace(required: number) {
    if (this.y - required < MARGIN) {
      this.page = this.docInstance.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      this.y = PAGE_HEIGHT - MARGIN
    }
  }

  private measure(size: number, weight: FontWeight = "regular"): Measure {
    return (text) => this.fonts!.widthOf(text, size, weight)
  }

  async addHeading(text: string, size = 18) {
    for (const line of await wrapLine(text, this.measure(size, "bold"), TEXT_WIDTH)) {
      this.ensureSpace(size + 8)
      await this.fonts!.draw(this.page, line, { x: MARGIN, y: this.y, size, color: rgb(0, 0, 0), weight: "bold" })
      this.y -= size + 8
    }
  }

  async addSubHeading(text: string, size = 14) {
    for (const line of await wrapLine(text, this.measure(size, "bold"), TEXT_WIDTH)) {
      this.ensureSpace(size + 6)
      await this.fonts!.draw(this.page, line, { x: MARGIN, y: this.y, size, color: rgb(0.1, 0.1, 0.1), weight: "bold" })
      this.y -= size + 6
    }
  }

  async addParagraph(text: string, size = 10) {
    const lines = await wrapParagraph(text, this.measure(size), TEXT_WIDTH)
    for (const line of lines) {
      this.ensureSpace(LINE_HEIGHT)
      if (line === "") {
        this.y -= LINE_HEIGHT
        continue
      }
      await this.fonts!.draw(this.page, line, { x: MARGIN, y: this.y, size, color: rgb(0, 0, 0) })
      this.y -= LINE_HEIGHT
    }
    this.y -= 4
  }

  async addBullet(text: string, size = 10) {
    const lines = await wrapLine(`• ${text}`, this.measure(size), TEXT_WIDTH - 12)
    for (let i = 0; i < lines.length; i++) {
      this.ensureSpace(LINE_HEIGHT)
      const x = i === 0 ? MARGIN + 12 : MARGIN + 24
      await this.fonts!.draw(this.page, lines[i], { x, y: this.y, size, color: rgb(0, 0, 0) })
      this.y -= LINE_HEIGHT
    }
  }

  async bytes(): Promise<Uint8Array> {
    const doc = await this.doc
    return doc.save()
  }
}

export async function buildCasePackPdf(pack: FidrecSubmissionPack): Promise<Uint8Array> {
  const builder = new PdfBuilder()
  await builder.init()

  await builder.addHeading("FIDReC Case Pack")
  await builder.addParagraph(`Case ID: ${pack.case_id}`)
  await builder.addParagraph(
    `Generated: ${pack.generated_at ? new Date(pack.generated_at).toLocaleString() : "n/a"}`,
  )
  await builder.addParagraph(`Version: ${pack.pack_version}`)
  await builder.addParagraph(AUTOMATED_OUTPUT_NOTICE)

  await builder.addSubHeading("Executive Summary")
  await builder.addParagraph(pack.executive_summary.narrative || "No executive summary available.")

  if (pack.chronology_of_events && pack.chronology_of_events.length > 0) {
    await builder.addSubHeading("Chronology of Events")
    for (const event of pack.chronology_of_events) {
      const date = event.event_datetime
        ? new Date(event.event_datetime).toLocaleString()
        : "Unknown date"
      let text = `${date} — ${event.event_text}`
      if (event.supporting_evidence && event.supporting_evidence.length > 0) {
        text += ` (Evidence: ${event.supporting_evidence.join(", ")})`
      }
      await builder.addBullet(text)
    }
    builder["y"] -= 8
  }

  if (pack.customer_position?.points && pack.customer_position.points.length > 0) {
    await builder.addSubHeading("Customer Position")
    await builder.addParagraph(pack.customer_position.narrative)
    for (const point of pack.customer_position.points) {
      let text = point.statement
      if (point.evidence_labels.length > 0) {
        text += ` (Evidence: ${point.evidence_labels.join(", ")})`
      }
      await builder.addBullet(text)
    }
    builder["y"] -= 8
  }

  if (pack.bank_position?.stated_grounds && pack.bank_position.stated_grounds.length > 0) {
    await builder.addSubHeading("Bank Position")
    await builder.addParagraph(pack.bank_position.narrative)
  }

  if (pack.issues_in_dispute && pack.issues_in_dispute.length > 0) {
    await builder.addSubHeading("Issues in Dispute")
    for (const issue of pack.issues_in_dispute) {
      await builder.addSubHeading(issue.issue_title, 12)
      await builder.addParagraph(issue.explanation)
      await builder.addParagraph(`Customer position: ${issue.customer_position}`)
      await builder.addParagraph(`Bank position: ${issue.bank_position}`)
      if (issue.evidence_available.length > 0) {
        await builder.addParagraph(`Evidence available: ${issue.evidence_available.join(", ")}`)
      }
      if (issue.evidence_required.length > 0) {
        await builder.addParagraph(`Evidence required: ${issue.evidence_required.join(", ")}`)
      }
    }
  }

  if (pack.evidence_bundle && pack.evidence_bundle.length > 0) {
    await builder.addSubHeading("Evidence Bundle")
    for (const item of pack.evidence_bundle) {
      await builder.addSubHeading(`${item.evidence_label} — ${item.title}`, 12)
      await builder.addParagraph(item.summary)
      await builder.addParagraph(`Why it matters: ${item.why_it_matters}`)
      if (item.supports_issues.length > 0) {
        await builder.addParagraph(`Supports issues: ${item.supports_issues.join(", ")}`)
      }
    }
  }

  if (pack.outstanding_evidence) {
    const { requested_from_bank, requested_from_customer } = pack.outstanding_evidence
    if (requested_from_bank.length > 0 || requested_from_customer.length > 0) {
      await builder.addSubHeading("Outstanding Evidence")
      if (requested_from_bank.length > 0) {
        await builder.addParagraph("Requested from bank:")
        for (const text of requested_from_bank) {
          await builder.addBullet(text)
        }
      }
      if (requested_from_customer.length > 0) {
        await builder.addParagraph("Requested from customer:")
        for (const text of requested_from_customer) {
          await builder.addBullet(text)
        }
      }
    }
  }

  if (pack.applicable_regulatory_framework?.provisions && pack.applicable_regulatory_framework.provisions.length > 0) {
    await builder.addSubHeading("Applicable Regulatory Framework")
    await builder.addParagraph(pack.applicable_regulatory_framework.introductory_text)
    for (const provision of pack.applicable_regulatory_framework.provisions) {
      await builder.addBullet(
        `${provision.document_name} — ${provision.clause_reference}: ${provision.clause_title}`,
      )
    }
  }

  if (pack.annexures && pack.annexures.length > 0) {
    await builder.addSubHeading("Annexures")
    for (const annex of pack.annexures) {
      await builder.addBullet(`${annex.annexure_label} — ${annex.evidence_label}: ${annex.title}`)
    }
  }

  return builder.bytes()
}
