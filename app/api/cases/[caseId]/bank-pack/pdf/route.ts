import { NextResponse } from "next/server"

import { factsCaseAccess } from "@/lib/server/facts/case-access"
import { buildBankPackPdf } from "@/lib/server/facts/bank-pack-pdf"
import { createUserClient } from "@/lib/supabase/server"
import type { ReportJson } from "@/lib/types/report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// "Download PDF" on the bank pack. Anyone who can view the case can download it; the pack is read with the user's own
// client, so access is the same as on screen.
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from("reports")
    .select("report_json, created_at")
    .eq("case_id", caseId)
    .eq("report_type", "bank_pack_v1")
    .not("report_json", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Failed to load the bank pack" }, { status: 500 })
  if (!data) return NextResponse.json({ error: "There is no bank pack for this case yet" }, { status: 404 })

  const pdf = await buildBankPackPdf(data.report_json as ReportJson, data.created_at)
  return new NextResponse(Buffer.from(pdf) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="guidebuoy-bank-pack-${caseId}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
