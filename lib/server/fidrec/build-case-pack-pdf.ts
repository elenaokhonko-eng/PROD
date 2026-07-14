import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib"
import type { FidrecSubmissionPack } from "@/lib/types/fidrec-case-pack"

const MARGIN = 50
const LINE_HEIGHT = 14
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2

function wrapLine(text: string, font: { widthOfTextAtSize: (text: string, size: number) => number }, size: number, maxWidth: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [text]
}

function wrapParagraph(text: string, font: { widthOfTextAtSize: (text: string, size: number) => number }, size: number, maxWidth: number): string[] {
  const paragraphs = text.split("\n")
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("")
      continue
    }
    const wrapped = wrapLine(paragraph, font, size, maxWidth)
    for (const line of wrapped) {
      lines.push(line)
    }
  }
  return lines
}

class PdfBuilder {
  private doc = PDFDocument.create()
  private fontPromise: Promise<PDFFont> | null = null
  private boldFontPromise: Promise<PDFFont> | null = null
  private page: any = null
  private y = 0

  async init() {
    const doc = await this.doc
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
    this.fontPromise = doc.embedFont(StandardFonts.Helvetica)
    this.boldFontPromise = doc.embedFont(StandardFonts.HelveticaBold)
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

  async addHeading(text: string, size = 18) {
    const font = await this.boldFontPromise!
    this.ensureSpace(size + 8)
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font, color: rgb(0, 0, 0) })
    this.y -= size + 8
  }

  async addSubHeading(text: string, size = 14) {
    const font = await this.boldFontPromise!
    this.ensureSpace(size + 6)
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font, color: rgb(0.1, 0.1, 0.1) })
    this.y -= size + 6
  }

  async addParagraph(text: string, size = 10) {
    const font = await this.fontPromise!
    const lines = wrapParagraph(text, font, size, TEXT_WIDTH)
    for (const line of lines) {
      this.ensureSpace(LINE_HEIGHT)
      if (line === "") {
        this.y -= LINE_HEIGHT
        continue
      }
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color: rgb(0, 0, 0) })
      this.y -= LINE_HEIGHT
    }
    this.y -= 4
  }

  async addBullet(text: string, size = 10) {
    const font = await this.fontPromise!
    const bulletText = `• ${text}`
    const lines = wrapLine(bulletText, font, size, TEXT_WIDTH - 12)
    for (let i = 0; i < lines.length; i++) {
      this.ensureSpace(LINE_HEIGHT)
      const x = i === 0 ? MARGIN + 12 : MARGIN + 24
      this.page.drawText(lines[i], { x, y: this.y, size, font, color: rgb(0, 0, 0) })
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
