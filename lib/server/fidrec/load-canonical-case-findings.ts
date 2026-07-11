import { normalizeSemanticText } from "@/lib/server/fidrec/consolidate-investigation-issues"

export type LoadedCaseFinding = {
  id: string
  finding_text: string
  finding_type: string
  supporting_evidence?: unknown
  confidence?: string
  missing_information?: unknown
  human_review_required?: boolean
  created_at: string
}

function canonicalFindingKey(finding: Pick<LoadedCaseFinding, "finding_text" | "finding_type">): string {
  return `${finding.finding_type}::${normalizeSemanticText(finding.finding_text)}`
}

export function selectCanonicalCaseFindings<T extends LoadedCaseFinding>(findings: T[]): T[] {
  const byKey = new Map<string, T>()

  for (const finding of findings) {
    const key = canonicalFindingKey(finding)
    const existing = byKey.get(key)
    if (!existing || finding.created_at.localeCompare(existing.created_at) > 0) {
      byKey.set(key, finding)
    }
  }

  return [...byKey.values()].sort((left, right) => left.created_at.localeCompare(right.created_at))
}
