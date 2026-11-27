import { APPROVED } from "@/lib/facts"
import { PAID_PACK_NOTICE } from "@/lib/legal/automated-output-notice"
import { PdfBuilder } from "@/lib/server/fidrec/build-case-pack-pdf"
import type { FidrecPackJson } from "@/lib/types/report"

// The FIDReC pack as a PDF: the same sections as the screen (fidrec-pack-view.tsx), in the same order, with the
// generation date and the paid packs' notice. Unicode fonts, as for the bank pack.

export async function buildFidrecPackPdf(pack: FidrecPackJson, createdAt: string | null): Promise<Uint8Array> {
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
  await builder.addSubHeading("Chronology")
  if (!pack.timeline?.length) await builder.addParagraph(APPROVED.noDatedEvents)
  for (const item of pack.timeline ?? []) await builder.addBullet(item.date ? `${item.date}: ${item.event}` : item.event)
  await builder.addSubHeading("Disputed transactions")
  if (!pack.disputed_transactions?.length) await builder.addParagraph(APPROVED.noPayments)
  await builder.addTable(pack.disputed_transactions ?? [])
  await builder.addParagraph(pack.total_loss ? `Amount lost: ${pack.total_loss}` : APPROVED.noTotal)
  await section("The complainant’s position", pack.claimant_position)
  await section("The institution’s position", pack.institution_position)
  for (const [title, items, none] of [
    ["Points for the complainant", pack.arguments_for_claimant, null],
    ["Points for the institution", pack.arguments_for_institution, APPROVED.noInstitutionPoint],
  ] as const) {
    if (!items?.length && !none) continue
    await builder.addSubHeading(title)
    if (!items?.length) await builder.addParagraph(none!)
    for (const item of items ?? []) await builder.addBullet(item.evidence_ids.length ? `${item.text} (${item.evidence_ids.join(", ")})` : item.text)
  }
  await builder.addSubHeading("The institution’s duties and what the records show")
  if (pack.duties_note) await builder.addParagraph(pack.duties_note)
  if (!pack.institution_duties?.length && !pack.duties_note) await builder.addParagraph(APPROVED.noDutySetOut)
  for (const duty of pack.institution_duties ?? []) {
    await builder.addBullet(`${duty.text} (${[...duty.clause_ids, ...duty.evidence_ids].join(", ")})`)
  }
  for (const source of pack.regulatory_sources ?? []) {
    await builder.addParagraph(`${source.id}: ${[source.source, source.clause_ref, source.title].filter(Boolean).join(", ")}`)
  }
  await builder.addSubHeading("Evidence index")
  if (!pack.evidence_index?.length) await builder.addParagraph(APPROVED.noDocuments)
  for (const item of pack.evidence_index ?? []) await builder.addBullet(`${item.id}: ${item.document}`)
  await section("How the rules may apply", pack.rules_assessment)
  await builder.addSubHeading("Evidence checklist")
  if (!pack.evidence_checklist?.length) await builder.addParagraph(APPROVED.noDocuments)
  for (const item of pack.evidence_checklist ?? []) await builder.addBullet(`${item.present ? "Shown" : "Missing"}: ${item.label}`)
  return builder.bytes()
}
