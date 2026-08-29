"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"

import {
  clearConvertedRouterSessionToken,
  getConvertedRouterSessionToken,
  getSessionToken,
  persistConvertedRouterSessionToken,
} from "@/lib/router-session"

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center">
      <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()
  const [status, setStatus] = useState<"checking" | "importing" | "complete" | "no_session" | "error">("checking")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded) return

    if (!isSignedIn) {
      router.replace("/sign-up?redirect_url=/onboarding")
      return
    }

    const importSession = async (token: string) => {
      try {
        setStatus("importing")
        const response = await fetch("/api/cases/create-from-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })

        const data = (await response.json()) as { caseId?: string; error?: string }
        if (!response.ok) {
          throw new Error(data.error || `Failed to import session (${response.status})`)
        }

        if (!data.caseId) {
          throw new Error("Import succeeded but no case was created")
        }

        clearConvertedRouterSessionToken()
        setStatus("complete")
        router.replace(`/app/case/${data.caseId}/dashboard`)
      } catch (err) {
        console.error("Onboarding import failed:", err)
        setError(err instanceof Error ? err.message : "Unknown error")
        setStatus("error")
      }
    }

    const token = getConvertedRouterSessionToken() ?? getSessionToken()
    if (token) {
      persistConvertedRouterSessionToken(token)
      void importSession(token)
    } else {
      setStatus("no_session")
      router.replace("/app")
    }
  }, [router, isLoaded, isSignedIn])

  if (status === "checking" || status === "importing") {
    return (
      <main className="min-h-screen bg-background">
        <SiteHeader />
        <div className="flex min-h-[70vh] flex-col items-center justify-center p-6">
          <div className="text-center">
            <LoadingSpinner />
            <p className="mt-4 text-lg font-semibold">Setting up your case</p>
            <p className="text-muted-foreground">Bringing across your saved story. Please wait.</p>
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-background">
        <SiteHeader />
        <div className="flex min-h-[70vh] items-center justify-center p-6">
          <Card className="w-full max-w-md border-border bg-card shadow-sm">
            <CardContent className="space-y-5 p-8 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">GuideBuoy AI</p>
              <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t start your case</h1>
              <p className="text-muted-foreground">Your saved story is still here. Please try again.</p>
              <Button onClick={() => window.location.reload()}>Try again</Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Redirecting...</p>
    </div>
  )
}
