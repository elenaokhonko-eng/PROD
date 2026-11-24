import { PAID_PACK_NOTICE } from "@/lib/legal/automated-output-notice"
import { PdfBuilder } from "@/lib/server/fidrec/build-case-pack-pdf"
import type { FidrecPackJson } from "@/lib/types/report"

// The FIDReC pack as a PDF: the same sections as the screen (fidrec-pack-view.tsx), in the same order, with the
// generation date and the paid packs' notice. Unicode fonts, as for the bank pack.

// The FIDReC update's server-written sections (FIDREC_UPDATE_SECTIONS_ENABLED; brief v5 4i): printed between the
// positions and the points for each side, exactly as stored in the report. Absent from a report made with the switch
// off, so such a report prints as before.
type PrintedUpdateSection = { id: string; heading: string; lines: Array<{ kind: "heading" | "paragraph" | "bullet"; text: string }> }
type PinnedUpdateCitation = { id: string; clauseRef: string | null; clauseKey: string; documentTitle: string | null; versionLabel: string; sourceUrl: string | null }
export type FidrecPackWithUpdate = Omit<FidrecPackJson, "arguments_for_claimant" | "arguments_for_institution"> & {
  update_sections?: PrintedUpdateSection[]
  update_citations?: PinnedUpdateCitation[]
  arguments_for_claimant?: Array<{ text: string; evidence_ids: string[]; clause_ids?: string[] }>
  arguments_for_institution?: Array<{ text: string; evidence_ids: string[]; clause_ids?: string[] }>
}

// wording awaiting Elena's approval: the heading of the list of clauses the update's sections cite.
export const UPDATE_SOURCES_HEADING = "Documents cited in the sections above"

export async function buildFidrecPackPdf(pack: FidrecPackWithUpdate, createdAt: string | null): Promise<Uint8Array> {
  const builder = new PdfBuilder()
  await builder.init()

  await builder.addHeading(pack.title ?? "Your FIDReC pack")
  await builder.addParagraph(
    `Generated: ${createdAt ? new Date(createdAt).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "n/a"}`,
  )
  await builder.addParagraph(PAID_PACK_NOTICE)

  const section = async (title: string, text: string | undefined | null) => {
    if (!text) return
    await builder.addSubHeading(title)
    await builder.addParagraph(text)
  }
  await section("Executive summary", pack.executive_summary)
  await section("Filing with FIDReC", pack.route)
  if (pack.timeline?.length) {
    await builder.addSubHeading("Chronology")
    for (const item of pack.timeline) await builder.addBullet(item.date ? `${item.date}: ${item.event}` : item.event)
  }
  if (pack.disputed_transactions?.length) {
    await builder.addSubHeading("Disputed transactions")
    for (const row of pack.disputed_transactions) {
      await builder.addBullet(Object.entries(row).map(([column, cell]) => `${column.replace(/_/g, " ")}: ${String(cell)}`).join("; "))
    }
    if (pack.total_loss) await builder.addParagraph(`Amount lost: ${pack.total_loss}`)
  }
  await section("The complainant’s position", pack.claimant_position)
  await section("The institution’s position", pack.institution_position)
  for (const update of pack.update_sections ?? []) {
    await builder.addSubHeading(update.heading)
    for (const line of update.lines) {
      if (line.kind === "heading") await builder.addSubHeading(line.text, 11)
      else if (line.kind === "bullet") await builder.addBullet(line.text)
      else await builder.addParagraph(line.text)
    }
  }
  if (pack.update_sections?.length && pack.update_citations?.length) {
    await builder.addSubHeading(UPDATE_SOURCES_HEADING)
    for (const c of pack.update_citations) {
      const where = c.clauseRef ?? c.clauseKey.split("/")[1] ?? c.clauseKey
      await builder.addBullet(`${c.id}: ${[c.documentTitle, where, `version ${c.versionLabel}`, c.sourceUrl].filter(Boolean).join(", ")}`)
    }
  }
  for (const [title, items] of [
    ["Points for the complainant", pack.arguments_for_claimant],
    ["Points for the institution", pack.arguments_for_institution],
  ] as const) {
    if (!items?.length) continue
    await builder.addSubHeading(title)
    for (const item of items) {
      const ids = [...item.evidence_ids, ...(item.clause_ids ?? [])]
      await builder.addBullet(ids.length ? `${item.text} (${ids.join(", ")})` : item.text)
    }
  }
  if (pack.institution_duties?.length) {
    await builder.addSubHeading("The institution’s duties and what the records show")
    for (const duty of pack.institution_duties) {
      await builder.addBullet(`${duty.text} (${[...duty.clause_ids, ...duty.evidence_ids].join(", ")})`)
    }
    for (const source of pack.regulatory_sources ?? []) {
      await builder.addParagraph(`${source.id}: ${[source.source, source.clause_ref, source.title].filter(Boolean).join(", ")}`)
    }
  }
  if (pack.evidence_index?.length) {
    await builder.addSubHeading("Evidence index")
    for (const item of pack.evidence_index) await builder.addBullet(`${item.id}: ${item.document}`)
  }
  await section("How the rules may apply", pack.rules_assessment)
  if (pack.evidence_checklist?.length) {
    await builder.addSubHeading("Evidence checklist")
    for (const item of pack.evidence_checklist) await builder.addBullet(`${item.present ? "Shown" : "Missing"}: ${item.label}`)
  }
  return builder.bytes()
}
