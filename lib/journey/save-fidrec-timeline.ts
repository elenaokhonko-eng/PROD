import { fidrecTimelineResponses, type FidrecTimeline } from '@/lib/journey/fidrec-timeline'

type GetToken = (options: { template: string; skipCache?: boolean }) => Promise<string | null>

export async function saveFidrecTimeline(caseId: string, timeline: FidrecTimeline, getToken: GetToken): Promise<void> {
  // A new account's cached token can predate its profile link.
  const token = await getToken({ template: 'supabase', skipCache: true })
  if (!token) throw new Error('Missing Supabase token')
  const response = await fetch(`/api/cases/${caseId}/responses`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ responses: fidrecTimelineResponses(timeline) }),
  })
  if (!response.ok) throw new Error('Failed to save responses')
}
