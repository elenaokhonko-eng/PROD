import { PdfBuilder } from "@/lib/server/fidrec/build-case-pack-pdf"
import type { CaseNarrativeRow } from "@/lib/types/narratives"

// The free evaluation as a PDF (finding C5): the same sections as the screen, in the same order, with the
// generation date and the automated-output notice.

export const AUTOMATED_OUTPUT_NOTICE =
  "Generated automatically by GuideBuoy AI using a pre-built workflow. It has not been reviewed by a person. For a human review, book a consultation (S$99 / 30 min)."

const ORDER = ["tier0_summary", "tier0_report_now", "tier0_evidence_checklist", "tier0_confirmed_facts", "tier0_srf_signal"]

// The standard PDF fonts cover Windows-1252 only; anything else (symbols, other scripts) becomes "?".
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"
function printable(text: string): string {
  return [...text].map((c) => {
    const code = c.charCodeAt(0)
    return c === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(c) ? c : "?"
  }).join("")
}

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
    await builder.addSubHeading(printable(row.title ?? type))
    await builder.addParagraph(printable(row.text_content))
  }
  return builder.bytes()
}
