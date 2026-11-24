import { PAID_PACK_NOTICE } from "@/lib/legal/automated-output-notice"
import { PdfBuilder } from "@/lib/server/fidrec/build-case-pack-pdf"
import type { ReportJson } from "@/lib/types/report"

// The bank pack as a PDF: the same sections as the screen (report-view.tsx), in the same order, with the generation
// date and the paid packs' notice (stage2-plan decision 8). Unicode fonts as for the free evaluation, so accented and
// non-Latin names print as written.

// wording awaiting Elena's approval: the headings of the update's lines in the bank pack.
export const BANK_UPDATE_HEADINGS = {
  requests: "Records I ask the bank to provide",
  section8: "What the E-Payments User Protection Guidelines say while a transaction is disputed",
} as const

export async function buildBankPackPdf(report: ReportJson, createdAt: string | null): Promise<Uint8Array> {
  const builder = new PdfBuilder()
  await builder.init()

  await builder.addHeading(report.title ?? "Your bank dispute pack")
  await builder.addParagraph(
    `Generated: ${createdAt ? new Date(createdAt).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "n/a"}`,
  )
  await builder.addParagraph(PAID_PACK_NOTICE)

  if (report.executive_summary) {
    await builder.addSubHeading("Executive summary")
    await builder.addParagraph(report.executive_summary)
  }
  if (Array.isArray(report.timeline) && report.timeline.length) {
    await builder.addSubHeading("Timeline")
    for (const item of report.timeline) await builder.addBullet(item.date ? `${item.date}: ${item.event}` : item.event)
  }
  if (Array.isArray(report.disputed_transactions) && report.disputed_transactions.length) {
    await builder.addSubHeading("Disputed transactions")
    for (const row of report.disputed_transactions) {
      await builder.addBullet(Object.entries(row).map(([column, cell]) => `${column.replace(/_/g, " ")}: ${String(cell)}`).join("; "))
    }
  }
  if (typeof report.total_loss === "string" && report.total_loss) await builder.addParagraph(`Amount lost: ${report.total_loss}`)
  if (typeof report.rules_assessment === "string" && report.rules_assessment) {
    await builder.addSubHeading("How the rules may apply")
    await builder.addParagraph(report.rules_assessment)
  }
  if (report.requested_resolution) {
    await builder.addSubHeading("Requested resolution")
    await builder.addParagraph(report.requested_resolution)
  }
  // The FIDReC update's lines (FIDREC_UPDATE_SECTIONS_ENABLED): absent from a report made with the switch off.
  const requests = Array.isArray(report.update_record_requests) ? (report.update_record_requests as string[]) : []
  if (requests.length) {
    await builder.addSubHeading(BANK_UPDATE_HEADINGS.requests)
    for (const request of requests) await builder.addBullet(request)
  }
  const section8 = Array.isArray(report.update_section8) ? (report.update_section8 as Array<{ text: string; references: string }>) : []
  if (section8.length) {
    await builder.addSubHeading(BANK_UPDATE_HEADINGS.section8)
    for (const line of section8) await builder.addParagraph(line.references ? `${line.text} (${line.references})` : line.text)
  }
  if (Array.isArray(report.evidence_checklist) && report.evidence_checklist.length) {
    await builder.addSubHeading("Evidence checklist")
    for (const item of report.evidence_checklist) await builder.addBullet(`${item.present ? "Shown" : "Missing"}: ${item.label}`)
  }
  return builder.bytes()
}
