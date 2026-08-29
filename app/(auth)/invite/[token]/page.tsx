"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, Loader2 } from "lucide-react"

export default function InvitationAcceptPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")
  const [attempt, setAttempt] = useState(0)
  const router = useRouter()
  const params = useParams()
  const token = params.token as string
  const { isLoaded, isSignedIn } = useAuth()
  const statusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (status !== "loading") statusRef.current?.focus()
  }, [status])

  useEffect(() => {
    if (!isLoaded) return

    if (!isSignedIn) {
      const returnPath = encodeURIComponent(`/invite/${token}`)
      router.replace(`/sign-up?redirect_url=${returnPath}`)
      return
    }

    const controller = new AbortController()
    let redirectTimer: number | undefined

    const acceptInvitation = async () => {
      setStatus("loading")
      setMessage("")
      try {
        const response = await fetch("/api/invitations/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationToken: token }),
          signal: controller.signal,
        })
        const data = (await response.json().catch(() => null)) as { caseId?: string } | null

        if (response.ok && data?.caseId) {
          setStatus("success")
          setMessage("You have joined the case.")
          redirectTimer = window.setTimeout(() => {
            router.replace(`/app/case/${data.caseId}/dashboard`)
          }, 1200)
          return
        }

        setStatus("error")
        setMessage("This invitation is invalid, expired, or unavailable to this account.")
      } catch {
        if (controller.signal.aborted) return
        setStatus("error")
        setMessage(
          navigator.onLine
            ? "The invitation could not be accepted. Try again without leaving this page."
            : "You're offline. Reconnect, then try again.",
        )
      }
    }

    void acceptInvitation()
    return () => {
      controller.abort()
      if (redirectTimer !== undefined) window.clearTimeout(redirectTimer)
    }
  }, [attempt, token, router, isLoaded, isSignedIn])

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Case invitation</CardTitle>
        <CardDescription>
          {status === "loading" ? "Checking this invitation securely." : "Invitation status"}
        </CardDescription>
      </CardHeader>
      <CardContent
        ref={statusRef}
        tabIndex={-1}
        className="flex flex-col items-center gap-4 outline-none"
        aria-live="polite"
        aria-busy={status === "loading"}
      >
        {status === "loading" && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden="true" />
            <p className="text-muted-foreground">Accepting invitation…</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="h-12 w-12 text-harbor-success" aria-hidden="true" />
            <p className="text-center font-medium">{message}</p>
            <p className="text-sm text-muted-foreground">Opening the case…</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-12 w-12 text-destructive" aria-hidden="true" />
            <p className="text-center font-medium" role="alert">{message}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button className="min-h-11" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
              <Button asChild variant="outline" className="min-h-11">
                <Link href="/">Return home</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
