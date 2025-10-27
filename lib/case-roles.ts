import { createClient } from "@/lib/supabase/client"
import { trackClientEvent } from "@/lib/analytics/client"

export type CaseRole = "victim" | "helper" | "lead_victim" | "defendant"

export interface CaseCollaborator {
  id: string
  case_id: string
  user_id: string
  role: CaseRole
  can_view: boolean
  can_edit: boolean
  can_invite: boolean
  invited_by: string | null
  invited_at: string | null
  accepted_at: string | null
  status: "pending" | "active" | "removed"
}

export async function getCaseWithRole(caseId: string, userId: string) {
  const supabase = createClient()

  const { data: caseData } = await supabase
    .from("cases")
    .select("*, owner_user_id, creator_user_id")
    .eq("id", caseId)
    .single()

  if (!caseData) return null

  if (caseData.owner_user_id === userId || caseData.creator_user_id === userId) {
    return {
      case: caseData,
      role: "victim" as CaseRole,
      permissions: ["read", "write", "delete", "invite"],
      isOwner: caseData.owner_user_id === userId,
    }
  }

  const { data: collaborator } = await supabase
    .from("case_collaborators")
    .select("role, can_view, can_edit, can_invite")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .eq("status", "active")
    .single()

  if (collaborator) {
    const permissions: string[] = []
    if (collaborator.can_view) permissions.push("read")
    if (collaborator.can_edit) permissions.push("write")
    if (collaborator.can_invite) permissions.push("invite")
    return {
      case: caseData,
      role: collaborator.role as CaseRole,
      permissions,
      isOwner: false,
    }
  }

  return null
}

export async function inviteCollaborator(caseId: string, inviterUserId: string, inviteeEmail: string, role: CaseRole) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      case_id: caseId,
      inviter_user_id: inviterUserId,
      invitee_email: inviteeEmail,
      role,
      status: "pending",
    })
    .select()
    .single()

  if (error) throw error

  await trackClientEvent({
    eventName: "collaborator_invited",
    userId: inviterUserId,
    eventData: { case_id: caseId, role, invitee_email: inviteeEmail },
    pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  })

  return data
}

export async function transferCaseOwnership(caseId: string, currentOwnerId: string, newOwnerId: string) {
  const supabase = createClient()

  const { error } = await supabase
    .from("cases")
    .update({
      owner_user_id: newOwnerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId)
    .eq("owner_user_id", currentOwnerId)

  if (error) throw error

  await trackClientEvent({
    eventName: "case_ownership_transferred",
    userId: currentOwnerId,
    eventData: { case_id: caseId, new_owner_id: newOwnerId },
    pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  })
}
