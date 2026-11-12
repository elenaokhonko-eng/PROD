"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Users, Mail, Loader2 } from "lucide-react"

interface CaseCollaboratorsProps {
  caseId: string
  isOwner: boolean
  currentUserId: string
}

type Collaborator = {
  id: string
  role: string
  user_id: string | null
  profiles?: {
    full_name?: string | null
    email?: string | null
  } | null
}

export default function CaseCollaborators({ caseId, isOwner }: CaseCollaboratorsProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("helper")
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [inviteStatus, setInviteStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null)
  const inviteStatusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (inviteStatus) inviteStatusRef.current?.focus()
  }, [inviteStatus])

  const fetchCollaborators = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) })
      if (res.ok) {
        const data = await res.json()
        setCollaborators(data.collaborators ?? [])
      }
    } catch {
      // ignore
    }
    setIsLoading(false)
  }, [caseId])

  useEffect(() => {
    void fetchCollaborators()
  }, [fetchCollaborators])

  const handleInvite = async () => {
    if (!inviteEmail) return

    setIsSending(true)
    setInviteStatus(null)
    try {
      const response = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, email: inviteEmail, role: inviteRole }),
      })

      if (response.ok) {
        setInviteStatus({ kind: "success", message: "Invitation sent successfully." })
        setInviteEmail("")
      } else {
        const data = await response.json()
        setInviteStatus({ kind: "error", message: data.error || "Failed to send invitation." })
      }
    } catch {
      setInviteStatus({ kind: "error", message: "The invitation could not be sent. Check your connection and try again." })
    } finally {
      setIsSending(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Case Collaborators
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {collaborators.length > 0 ? (
          <div className="space-y-3">
            {collaborators.map((collaborator) => (
              <div key={collaborator.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{collaborator.profiles?.full_name || collaborator.profiles?.email}</p>
                    <Badge variant="secondary" className="text-xs">
                      {collaborator.role}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No collaborators yet</p>
        )}

        {isOwner && (
          <div className="space-y-3 pt-4 border-t">
            {inviteStatus && (
              <div
                ref={inviteStatusRef}
                role={inviteStatus.kind === "error" ? "alert" : "status"}
                tabIndex={-1}
                className={`rounded-lg border p-3 text-sm outline-none ${inviteStatus.kind === "error" ? "border-destructive/40 bg-harbor-error-tint" : "border-harbor-success/40 bg-harbor-success-tint"}`}
              >
                {inviteStatus.message}
              </div>
            )}
            <Label htmlFor="invite-email">Invite collaborator</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <Label htmlFor="invite-role">Collaborator role</Label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="helper">Helper</option>
              <option value="lead_victim">Lead Claimant</option>
            </select>
            <Button onClick={handleInvite} disabled={isSending || !inviteEmail} className="w-full">
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Invitation
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
