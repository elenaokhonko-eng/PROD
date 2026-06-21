import { createServiceClient } from "@/lib/supabase/service"
import type { AssertionFindingRelationship } from "@/lib/types/fidrec"

const RELATIONSHIP_PRIORITY: Record<AssertionFindingRelationship, number> = {
  rebuts_bank_assertion: 5,
  partially_rebuts: 4,
  requires_particulars: 3,
  supports_bank_assertion: 2,
  irrelevant: 1,
}

export type OpenThemeContext = {
  theme: {
    id: string
    theme_type: string
    theme_title: string
    theme_summary: string | null
    priority: string
  }
  assertions: Array<{
    id: string
    assertion_text: string
    assertion_type: string
    particulars_needed: unknown
    evidence_needed: unknown
  }>
  findings: Array<{
    id: string
    finding_text: string
    finding_type: string
    supporting_evidence: unknown
    missing_information: unknown
    human_review_required: boolean
  }>
  links: Array<{
    id: string
    bank_assertion_id: string
    finding_id: string
    relationship: string
    explanation: string | null
    confidence: string
    next_question: string | null
  }>
  evidenceRequests: Array<{
    id: string
    request_text: string
    evidence_category: string
    requested_from: string
    priority: string
  }>
}

export function resolveDominantThemeSources(context: OpenThemeContext): {
  source_assertion_id: string | null
  source_finding_id: string | null
  source_link_id: string | null
} {
  const relevantLinks = context.links.filter((link) => link.relationship !== "irrelevant")
  if (relevantLinks.length === 0) {
    return {
      source_assertion_id: context.assertions[0]?.id ?? null,
      source_finding_id: context.findings[0]?.id ?? null,
      source_link_id: null,
    }
  }

  const dominantLink = relevantLinks.reduce((best, current) => {
    const bestPriority = RELATIONSHIP_PRIORITY[best.relationship as AssertionFindingRelationship] ?? 0
    const currentPriority = RELATIONSHIP_PRIORITY[current.relationship as AssertionFindingRelationship] ?? 0
    return currentPriority > bestPriority ? current : best
  })

  return {
    source_assertion_id: dominantLink.bank_assertion_id,
    source_finding_id: dominantLink.finding_id,
    source_link_id: dominantLink.id,
  }
}

export async function loadOpenThemeContexts(caseId: string): Promise<OpenThemeContext[]> {
  const supabase = createServiceClient()

  const { data: openThemes, error: themesError } = await supabase
    .from("case_themes")
    .select("id, theme_type, theme_title, theme_summary, priority")
    .eq("case_id", caseId)
    .eq("status", "open")
    .order("created_at", { ascending: true })

  if (themesError) {
    throw new Error(`Failed to load open case_themes rows: ${themesError.message}`)
  }

  if (!openThemes?.length) {
    return []
  }

  const themeIds = openThemes.map((theme) => theme.id)

  const { data: themeLinks, error: themeLinksError } = await supabase
    .from("case_theme_links")
    .select(
      "theme_id, bank_assertion_id, finding_id, assertion_finding_link_id, investigation_question_id, evidence_request_id",
    )
    .eq("case_id", caseId)
    .in("theme_id", themeIds)

  if (themeLinksError) {
    throw new Error(`Failed to load case_theme_links rows: ${themeLinksError.message}`)
  }

  const assertionIds = [
    ...new Set((themeLinks ?? []).map((link) => link.bank_assertion_id).filter(Boolean)),
  ] as string[]
  const findingIds = [...new Set((themeLinks ?? []).map((link) => link.finding_id).filter(Boolean))] as string[]
  const linkIds = [
    ...new Set((themeLinks ?? []).map((link) => link.assertion_finding_link_id).filter(Boolean)),
  ] as string[]
  const evidenceRequestIds = [
    ...new Set((themeLinks ?? []).map((link) => link.evidence_request_id).filter(Boolean)),
  ] as string[]

  const [assertionsResult, findingsResult, linksResult, evidenceRequestsResult] = await Promise.all([
    assertionIds.length
      ? supabase
          .from("case_bank_assertions")
          .select("id, assertion_text, assertion_type, particulars_needed, evidence_needed")
          .in("id", assertionIds)
      : Promise.resolve({ data: [], error: null }),
    findingIds.length
      ? supabase
          .from("case_findings")
          .select(
            "id, finding_text, finding_type, supporting_evidence, missing_information, human_review_required",
          )
          .in("id", findingIds)
      : Promise.resolve({ data: [], error: null }),
    linkIds.length
      ? supabase
          .from("case_assertion_finding_links")
          .select("id, bank_assertion_id, finding_id, relationship, explanation, confidence, next_question")
          .in("id", linkIds)
      : Promise.resolve({ data: [], error: null }),
    evidenceRequestIds.length
      ? supabase
          .from("case_evidence_requests")
          .select("id, request_text, evidence_category, requested_from, priority")
          .in("id", evidenceRequestIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (assertionsResult.error) {
    throw new Error(`Failed to load theme-linked case_bank_assertions rows: ${assertionsResult.error.message}`)
  }
  if (findingsResult.error) {
    throw new Error(`Failed to load theme-linked case_findings rows: ${findingsResult.error.message}`)
  }
  if (linksResult.error) {
    throw new Error(`Failed to load theme-linked case_assertion_finding_links rows: ${linksResult.error.message}`)
  }
  if (evidenceRequestsResult.error) {
    throw new Error(`Failed to load theme-linked case_evidence_requests rows: ${evidenceRequestsResult.error.message}`)
  }

  const assertionById = new Map((assertionsResult.data ?? []).map((row) => [row.id, row]))
  const findingById = new Map((findingsResult.data ?? []).map((row) => [row.id, row]))
  const linkById = new Map((linksResult.data ?? []).map((row) => [row.id, row]))
  const evidenceRequestById = new Map((evidenceRequestsResult.data ?? []).map((row) => [row.id, row]))

  const linksByThemeId = new Map<string, NonNullable<typeof themeLinks>>()
  for (const link of themeLinks ?? []) {
    const group = linksByThemeId.get(link.theme_id) ?? []
    group.push(link)
    linksByThemeId.set(link.theme_id, group)
  }

  return openThemes.map((theme) => {
    const linkedRows = linksByThemeId.get(theme.id) ?? []

    const assertions = [
      ...new Map(
        linkedRows
          .map((row) => row.bank_assertion_id)
          .filter(Boolean)
          .map((id) => [id, assertionById.get(id!)])
          .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
      ).values(),
    ]

    const findings = [
      ...new Map(
        linkedRows
          .map((row) => row.finding_id)
          .filter(Boolean)
          .map((id) => [id, findingById.get(id!)])
          .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
      ).values(),
    ]

    const links = [
      ...new Map(
        linkedRows
          .map((row) => row.assertion_finding_link_id)
          .filter(Boolean)
          .map((id) => [id, linkById.get(id!)])
          .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
      ).values(),
    ]

    const evidenceRequests = [
      ...new Map(
        linkedRows
          .map((row) => row.evidence_request_id)
          .filter(Boolean)
          .map((id) => [id, evidenceRequestById.get(id!)])
          .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
      ).values(),
    ]

    return {
      theme,
      assertions,
      findings,
      links,
      evidenceRequests,
    }
  })
}
