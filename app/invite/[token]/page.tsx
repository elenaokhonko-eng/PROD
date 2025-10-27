"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, Loader2 } from "lucide-react"

export default function InvitationAcceptPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")
  const router = useRouter()
  const params = useParams()
  const token = params.token as string

  useEffect(() => {
    const acceptInvitation = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        // Redirect to signup with invitation token
        router.push(`/auth/sign-up?invite=${token}`)
        return
      }

      try {
        const response = await fetch("/api/invitations/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationToken: token }),
        })

        const data = await response.json()

        if (response.ok) {
          setStatus("success")
          setMessage("You've successfully joined the case!")
          setTimeout(() => {
            router.push(`/app/case/${data.caseId}/dashboard`)
          }, 2000)
        } else {
          setStatus("error")
          setMessage(data.error || "Failed to accept invitation")
        }
      } catch (error) {
        setStatus("error")
        setMessage("An unexpected error occurred")
      }
    }

    acceptInvitation()
  }, [token, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Case Invitation</CardTitle>
          <CardDescription>Processing your invitation...</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {status === "loading" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">Accepting invitation...</p>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle className="h-12 w-12 text-green-600" />
              <p className="text-center font-medium">{message}</p>
              <p className="text-sm text-muted-foreground">Redirecting to case dashboard...</p>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-12 w-12 text-red-600" />
              <p className="text-center font-medium">{message}</p>
              <Button onClick={() => router.push("/")}>Return Home</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
