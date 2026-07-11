import { createServiceClient } from "@/lib/supabase/service"

export const CASE_NOT_FOUND = "CASE_NOT_FOUND" as const
export const CASE_ACCESS_DENIED = "CASE_ACCESS_DENIED" as const

export class CaseNotFoundError extends Error {
  readonly code = CASE_NOT_FOUND
  constructor() {
    super(CASE_NOT_FOUND)
    this.name = "CaseNotFoundError"
  }
}

export class CaseAccessDeniedError extends Error {
  readonly code = CASE_ACCESS_DENIED
  constructor() {
    super(CASE_ACCESS_DENIED)
    this.name = "CaseAccessDeniedError"
  }
}

export type AssertCaseAccessInput = {
  caseId: string
  userSupabaseUuid: string
}

/**
 * Verifies that a case exists and the user is the owner or an active collaborator.
 * Throws typed errors for routes to map to 404/403 responses.
 */
export async function assertCaseAccess(input: AssertCaseAccessInput): Promise<void> {
  const supabase = createServiceClient()

  const { data: caseRow, error: caseError } = await supabase
    .from("cases")
    .select("id, user_id")
    .eq("id", input.caseId)
    .single()

  if (caseError || !caseRow) {
    throw new CaseNotFoundError()
  }

  if (caseRow.user_id === input.userSupabaseUuid) {
    return
  }

  const { data: collaborator } = await supabase
    .from("case_collaborators")
    .select("user_id")
    .eq("case_id", input.caseId)
    .eq("user_id", input.userSupabaseUuid)
    .eq("status", "active")
    .maybeSingle()

  if (!collaborator) {
    throw new CaseAccessDeniedError()
  }
}
