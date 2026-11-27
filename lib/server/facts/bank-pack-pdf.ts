import { APPROVED } from "@/lib/facts"
import { PAID_PACK_NOTICE } from "@/lib/legal/automated-output-notice"
import { PdfBuilder } from "@/lib/server/fidrec/build-case-pack-pdf"
import type { ReportJson } from "@/lib/types/report"

// The bank pack as a PDF: the same sections as the screen (report-view.tsx), in the same order, with the generation
// date and the paid packs' notice (stage2-plan decision 8). Unicode fonts as for the free evaluation, so accented and
// non-Latin names print as written.

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
  await builder.addSubHeading("Timeline")
  if (!report.timeline?.length) await builder.addParagraph(APPROVED.noDatedEvents)
  else {
    for (const item of report.timeline) await builder.addBullet(item.date ? `${item.date}: ${item.event}` : item.event)
  }
  await builder.addSubHeading("Disputed transactions")
  if (!report.disputed_transactions?.length) await builder.addParagraph(APPROVED.noPayments)
  else await builder.addTable(report.disputed_transactions as Array<Record<string, string>>)
  await builder.addParagraph(typeof report.total_loss === "string" && report.total_loss ? `Amount lost: ${report.total_loss}` : APPROVED.noTotal)
  if (typeof report.rules_assessment === "string" && report.rules_assessment) {
    await builder.addSubHeading("How the rules may apply")
    await builder.addParagraph(report.rules_assessment)
  }
  if (report.requested_resolution) {
    await builder.addSubHeading("Requested resolution")
    await builder.addParagraph(report.requested_resolution)
  }
  await builder.addSubHeading("Evidence checklist")
  if (!report.evidence_checklist?.length) await builder.addParagraph(APPROVED.noDocuments)
  else {
    for (const item of report.evidence_checklist) await builder.addBullet(`${item.present ? "Shown" : "Missing"}: ${item.label}`)
  }
  return builder.bytes()
}
