import { NextResponse } from "next/server"

import { factsCaseAccess } from "@/lib/server/facts/case-access"
import { buildFreeEvaluationPdf } from "@/lib/server/facts/free-evaluation-pdf"
import { createUserClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FREE_SECTIONS = ["tier0_summary", "tier0_report_now", "tier0_evidence_checklist", "tier0_confirmed_facts", "tier0_transactions", "tier0_srf_signal"]

// "Download your free evaluation (PDF)" (finding C5). Anyone who can view the case can download it; the sections
// are read with the user's own client, so access is the same as on screen.
export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from("case_narratives")
    .select("narrative_type, title, text_content, created_at")
    .eq("case_id", caseId)
    .in("narrative_type", FREE_SECTIONS)
  if (error) return NextResponse.json({ error: "Failed to load the free evaluation" }, { status: 500 })
  if (!data?.some((row) => row.narrative_type === "tier0_summary")) {
    return NextResponse.json({ error: "There is no free evaluation for this case yet" }, { status: 404 })
  }

  const pdf = await buildFreeEvaluationPdf(data)
  return new NextResponse(Buffer.from(pdf) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="guidebuoy-free-evaluation-${caseId}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
