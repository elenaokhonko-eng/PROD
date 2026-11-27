'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/hooks/state-machine/query-keys'
import type { Stage } from '@/lib/facts'
import type { FactsView, ResolutionInput } from '@/lib/server/facts/facts-service'

export type { FactsView, ResolutionInput }

export class FactsRequestError extends Error {
  constructor(
    message: string,
    public readonly reason: string | null,
    public readonly status: number,
    /** Names of the server checks that failed, for a problem report (never their text). */
    public readonly checks: string[] = [],
    /** The FIDReC pack not ready yet: the written complaint's date and the day the four weeks end. */
    public readonly details: { complaintDate?: string | null; opensOn?: string | null } | null = null,
  ) {
    super(message)
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => null)) as (T & { error?: string; reason?: string }) | null
  if (!response.ok) {
    throw new FactsRequestError(json?.error ?? 'Request failed', json?.reason ?? null, response.status)
  }
  return json as T
}

export const FACTS_IN_PROGRESS_POLL_MS = 5_000

// Findings for one stage. The first load may take a while: the server reads the story, answers and documents.
// If a check is already running (the user left and came back), the server answers 202 and we ask again shortly.
export function useCaseFacts(caseId: string, stage: Stage, options: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: qk.case.facts(caseId, stage),
    queryFn: async (): Promise<FactsView | { inProgress: true }> => {
      const response = await fetch(`/api/cases/${caseId}/facts?stage=${stage}`, { cache: 'no-store' })
      if (response.status === 202) return { inProgress: true }
      return readJson<FactsView>(response)
    },
    refetchInterval: (query) => (query.state.data && 'inProgress' in query.state.data ? FACTS_IN_PROGRESS_POLL_MS : false),
    staleTime: 0,
    retry: 1,
  })
}

export function useResolveFinding(caseId: string, stage: Stage) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ findingId, resolution }: { findingId: string; resolution: ResolutionInput }) =>
      readJson<{ ok: true }>(
        await fetch(`/api/cases/${caseId}/facts/findings/${findingId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resolution),
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.case.facts(caseId, stage) }),
  })
}

export function useConfirmFacts(caseId: string, stage: Stage) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      readJson<{ ok: true; snapshotId: string; unchanged: boolean }>(
        await fetch(`/api/cases/${caseId}/facts/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage }),
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.case.facts(caseId, stage) }),
  })
}
