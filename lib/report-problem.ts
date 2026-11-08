// "Report a problem" (Elena, 7 Nov): the last error a screen showed, and the email report built from it. The report
// carries codes and IDs only, never the case's content; the person adds their own description. The server sends it
// (/api/report-problem, 8 Nov); the email link stays as a fallback.

export const REPORT_EMAIL = 'info@guidebuoyai.sg'
export const REPORT_SUBJECT = 'GuideBuoy problem report'
export const OPEN_REPORT_EVENT = 'gb:open-problem-report'

export type NotedProblem = { code: string; details: string[]; at: string }

let last: NotedProblem | null = null

/** Remember an error a screen just showed, so a report includes it. */
export function noteProblem(code: string, details: readonly string[] = []) {
  last = { code, details: [...details], at: new Date().toISOString() }
}

export function lastProblem(): NotedProblem | null {
  return last
}

/** Open the report panel, optionally noting the error that prompted it. */
export function openProblemReport(code?: string, details: readonly string[] = []) {
  if (code) noteProblem(code, details)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_REPORT_EVENT))
}

export function caseIdFromPath(pathname: string): string | null {
  return /\/app\/case\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname)?.[1] ?? null
}

export function buildReport(input: {
  description: string
  pathname: string
  time: string
  userAgent: string
  problem: NotedProblem | null
  /** The signed-in account's email, added by the server so the team can reply. */
  account?: string | null
  /** The deployed commit, added by the server. */
  release?: string | null
}): string {
  const caseId = caseIdFromPath(input.pathname)
  return [
    'What happened:',
    input.description.trim() || '(not described)',
    '',
    'Details:',
    `Page: ${input.pathname}`,
    `Case: ${caseId ?? 'none'}`,
    `Time: ${input.time}`,
    `Error: ${input.problem ? [input.problem.code, ...input.problem.details].join(', ') : 'none shown'}`,
    `Browser: ${input.userAgent}`,
    ...(input.account ? [`Account: ${input.account}`] : []),
    ...(input.release ? [`Release: ${input.release.slice(0, 12)}`] : []),
  ].join('\n')
}

export function reportMailto(body: string): string {
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(REPORT_SUBJECT)}&body=${encodeURIComponent(body)}`
}
