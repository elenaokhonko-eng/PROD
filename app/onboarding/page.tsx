"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@clerk/nextjs"

import {
  clearConvertedRouterSessionToken,
  getConvertedRouterSessionToken,
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
  const [status, setStatus] = useState<"checking" | "importing" | "complete" | "no_session">("checking")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded) return

    if (!isSignedIn) {
      clearConvertedRouterSessionToken()
      router.replace("/sign-in?redirect_url=/onboarding")
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
        clearConvertedRouterSessionToken()
        router.replace("/app")
      }
    }

    const token = getConvertedRouterSessionToken()
    if (token) {
      void importSession(token)
    } else {
      setStatus("no_session")
      router.replace("/app")
    }
  }, [router, isLoaded, isSignedIn])

  if (status === "checking" || status === "importing") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
        <div className="text-center">
          <LoadingSpinner />
          <p className="mt-4 text-lg font-semibold">Setting up your account...</p>
          <p className="text-muted-foreground">Importing your case data. Please wait.</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold text-destructive">An error occurred:</p>
          <p className="mb-4 text-muted-foreground">{error}</p>
          <Button onClick={() => router.replace("/app")} className="rounded-full">
            Go to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Redirecting...</p>
    </div>
  )
}

function Button({
  onClick,
  className,
  children,
}: {
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full bg-primary px-4 py-2 text-primary-foreground ${className ?? ""}`}
    >
      {children}
    </button>
  )
}
