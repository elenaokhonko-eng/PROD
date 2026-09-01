export type RouterResponses = Record<string, string>

type PersistResponses = (
  sessionToken: string,
  updates: { user_responses: RouterResponses },
) => Promise<unknown | null>

interface PersistAcceptedAnswerOptions {
  sessionToken: string
  responses: RouterResponses
  questionKey: string
  answer: string
  persist: PersistResponses
  onPersisted: (responses: RouterResponses) => void
}

export function restoreAcceptedResponses(value: unknown): RouterResponses {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, response]) =>
      typeof response === "string" || typeof response === "number"
        ? [[key, String(response)]]
        : [],
    ),
  )
}

export async function persistAcceptedAnswer({
  sessionToken,
  responses,
  questionKey,
  answer,
  persist,
  onPersisted,
}: PersistAcceptedAnswerOptions): Promise<RouterResponses> {
  const acceptedResponses = { ...responses, [questionKey]: answer }
  const savedSession = await persist(sessionToken, {
    user_responses: acceptedResponses,
  })

  if (!savedSession) throw new Error("Answer could not be saved")

  onPersisted(acceptedResponses)
  return acceptedResponses
}