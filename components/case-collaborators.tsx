"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Users, Mail, Trash2, Loader2 } from "lucide-react"
import { useSupabase } from "@/components/providers/supabase-provider"

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

export default function CaseCollaborators({ caseId, isOwner, currentUserId }: CaseCollaboratorsProps) {
  const supabase = useSupabase()
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("helper")
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)

  const fetchCollaborators = useCallback(async () => {
    const { data, error } = await supabase
      .from("case_collaborators")
      .select("*, profiles(full_name, email)")
      .eq("case_id", caseId)

    if (!error && data) {
      setCollaborators(data as Collaborator[])
    }
    setIsLoading(false)
  }, [caseId, supabase])

  useEffect(() => {
    void fetchCollaborators()
  }, [fetchCollaborators])

  const handleInvite = async () => {
    if (!inviteEmail) return

    setIsSending(true)
    try {
      const response = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, email: inviteEmail, role: inviteRole }),
      })

      if (response.ok) {
        alert("Invitation sent successfully!")
        setInviteEmail("")
      } else {
        const data = await response.json()
        alert(data.error || "Failed to send invitation")
      }
    } catch (error) {
      alert("An error occurred")
    } finally {
      setIsSending(false)
    }
  }

  const handleRemoveCollaborator = async (collaboratorId: string) => {
    if (!confirm("Are you sure you want to remove this collaborator?")) return
    const { error } = await supabase.from("case_collaborators").delete().eq("id", collaboratorId)

    if (!error) {
      void fetchCollaborators()
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
                {isOwner && collaborator.user_id !== currentUserId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveCollaborator(collaborator.id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No collaborators yet</p>
        )}

        {isOwner && (
          <div className="space-y-3 pt-4 border-t">
            <Label htmlFor="invite-email">Invite Collaborator</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="helper">Helper</option>
              <option value="lead_victim">Lead Victim</option>
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
