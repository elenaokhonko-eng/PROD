/**
 * TanStack Query key namespace. Single source of truth so cache invalidation
 * from mutation success callbacks and Realtime handlers stays consistent.
 *
 * Convention: every key starts with the entity name, then the case id (if
 * scoped), then any sub-discriminator. `as const` preserves literal types so
 * `queryClient.invalidateQueries({ queryKey: qk.case.eligibility(id) })`
 * compiles without stringifying.
 */

export const qk = {
  case: {
    base: (caseId: string) => ['case', caseId] as const,
    row: (caseId: string) => ['case', caseId, 'row'] as const,
    eligibility: (caseId: string) => ['case', caseId, 'eligibility'] as const,
    extract: (caseId: string) => ['case', caseId, 'extract'] as const,
    validation: (caseId: string) => ['case', caseId, 'validation'] as const,
    validationGapItems: (caseId: string, validationRunId?: string | null) =>
      validationRunId
        ? (['case', caseId, 'validation', 'gap-items', validationRunId] as const)
        : (['case', caseId, 'validation', 'gap-items'] as const),
    documents: (caseId: string) => ['case', caseId, 'documents'] as const,
    narratives: (caseId: string) => ['case', caseId, 'narratives'] as const,
    decision: (caseId: string) => ['case', caseId, 'decision'] as const,
    report: (caseId: string) => ['case', caseId, 'report'] as const,
    job: (caseId: string) => ['case', caseId, 'job'] as const,
    contactRequest: (caseId: string) => ['case', caseId, 'contact-request'] as const,
    tier2Pack: (caseId: string) => ['case', caseId, 'tier2-pack'] as const,
  },
  entitlement: (caseId: string) => ['entitlement', caseId] as const,
} as const
