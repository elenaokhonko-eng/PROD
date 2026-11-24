import { NextResponse } from 'next/server'
import { isEvidenceItem } from '@/lib/billing/evidence-minimums'
import { factsCaseAccess } from '@/lib/server/facts/case-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// "This is my police report": the case owner says what a document is when the evidence pipeline misread it, so a
// paying customer is never stuck on a misread document (Elena, 23 Nov 2026). The pack then describes it as identified
// by the complainant. item: null clears the mark.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string; documentId: string }> },
) {
  const { caseId, documentId } = await params
  const body = (await request.json().catch(() => null)) as { item?: unknown } | null
  const item = body?.item ?? null
  if (item !== null && !isEvidenceItem(item)) return NextResponse.json({ error: 'Unknown document item' }, { status: 400 })

  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access
  if (!access.isOwner) return NextResponse.json({ error: 'Only the case owner can do this' }, { status: 403 })

  const { data, error } = await createServiceClient()
    .from('case_documents')
    .update({ complainant_item: item })
    .eq('id', documentId)
    .eq('case_id', caseId)
    .select('id, complainant_item')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'The document could not be updated. Please try again.' }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  return NextResponse.json({ ok: true, document: data })
}
