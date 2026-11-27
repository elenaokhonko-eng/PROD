import { parsePaymentsTable } from "@/lib/facts"
import { AUTOMATED_OUTPUT_NOTICE } from "@/lib/legal/automated-output-notice"
import { PdfBuilder } from "@/lib/server/fidrec/build-case-pack-pdf"
import type { CaseNarrativeRow } from "@/lib/types/narratives"

// The free evaluation as a PDF (finding C5): the same sections as the screen, in the same order, with the
// generation date and the automated-output notice. Text prints in Unicode fonts (lib/server/pdf-fonts.ts), so names in
// Chinese or Tamil and symbols such as "·" print as written (Elena, 9 Nov).

export { AUTOMATED_OUTPUT_NOTICE }

const ORDER = ["tier0_summary", "tier0_report_now", "tier0_evidence_checklist", "tier0_confirmed_facts", "tier0_transactions", "tier0_srf_signal"]

export async function buildFreeEvaluationPdf(rows: readonly Pick<CaseNarrativeRow, "narrative_type" | "title" | "text_content" | "created_at">[]): Promise<Uint8Array> {
  const builder = new PdfBuilder()
  await builder.init()
  const generated = rows.map((r) => r.created_at).sort().at(-1)

  await builder.addHeading("GuideBuoy free evaluation")
  await builder.addParagraph(`Generated: ${generated ? new Date(generated).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "n/a"}`)
  await builder.addParagraph(AUTOMATED_OUTPUT_NOTICE)

  for (const type of ORDER) {
    const row = rows.find((r) => r.narrative_type === type)
    if (!row?.text_content.trim()) continue
    await builder.addSubHeading(row.title ?? type)
    const table = type === "tier0_transactions" ? parsePaymentsTable(row.text_content) : null
    if (table) await builder.addTable(table)
    else await builder.addParagraph(row.text_content)
  }
  return builder.bytes()
}
