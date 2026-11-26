"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import { Loader2, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  clearPendingNarrative,
  readPendingNarrative,
} from "@/components/landing/hero-capture"
import {
  clearConvertedRouterSessionToken,
  clearSessionToken,
  getSessionToken,
  rotateRouterSessionIntent,
} from "@/lib/router-session"
import { trackClientEvent } from "@/lib/analytics/client"
import { savedFirstTouch, trackFunnel } from "@/lib/analytics/funnel"
import { clearBootstrapIdempotencyKey, getOrCreateBootstrapIdempotencyKey } from "@/lib/journey/bootstrap-key"

// Just after sign-up the account can take a few seconds to be linked, so "not signed in" is retried quietly first.
const ACCOUNT_LINK_RETRIES = 3
const ACCOUNT_LINK_RETRY_MS = 2000

export default function OnboardingPage() {
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()
  const [status, setStatus] = useState<"checking" | "importing" | "complete" | "no_session" | "offline" | "error">("checking")
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const lastAttemptRef = useRef<number | null>(null)
  const linkRetriesRef = useRef(0)
  const errorRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (status === "error" || status === "offline") errorRef.current?.focus()
  }, [status])

  useEffect(() => {
    const handleOnline = () => setAttempt((value) => value + 1)
    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [])

  useEffect(() => {
    if (!isLoaded) return

    if (!isSignedIn) {
      router.replace("/sign-up?redirect_url=/onboarding")
      return
    }

    if (lastAttemptRef.current === attempt) return
    lastAttemptRef.current = attempt

    const pending = readPendingNarrative()
    if (!pending) {
      setStatus("no_session")
      return
    }

    if (!navigator.onLine) {
      setStatus("offline")
      return
    }

    const controller = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const bootstrapCase = async () => {
      try {
        setStatus("importing")
        setError(null)
        const response = await fetch("/api/cases/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": await getOrCreateBootstrapIdempotencyKey(pending),
          },
          body: JSON.stringify(pending),
          signal: controller.signal,
        })
        const data = (await response.json().catch(() => null)) as { case_id?: string; error?: string } | null

        if (response.status === 401 && linkRetriesRef.current < ACCOUNT_LINK_RETRIES) {
          linkRetriesRef.current += 1
          retryTimer = setTimeout(() => setAttempt((value) => value + 1), ACCOUNT_LINK_RETRY_MS)
          return
        }

        if (!response.ok || !data?.case_id) {
          setError(
            response.status === 401 || response.status === 403
              ? "Sign in with the account that should own this case, then try again."
              : response.status === 429 && data?.error
                ? `${data.error} Your saved draft remains available.`
                : "Your saved draft remains available so you can try again.",
          )
          setStatus("error")
          return
        }

        const legacySessionId = getSessionToken()
        clearPendingNarrative()
        clearBootstrapIdempotencyKey()
        clearConvertedRouterSessionToken()
        clearSessionToken()
        rotateRouterSessionIntent()
        setStatus("complete")
        void trackClientEvent({
          eventName: "router_conversion_imported",
          sessionId: legacySessionId,
          eventData: { case_id: data.case_id },
          pageUrl: window.location.href,
        })
        // Analytics 2: the step itself carries no case id; the case keeps only the channel it came from.
        trackFunnel("case_created")
        const firstTouch = savedFirstTouch()
        if (firstTouch) {
          void fetch(`/api/cases/${data.case_id}/first-touch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(firstTouch),
            keepalive: true,
          }).catch(() => {})
        }
        router.replace(`/app/case/${data.case_id}/dashboard`)
      } catch (bootstrapError) {
        if (controller.signal.aborted) return
        console.error("[onboarding] Case bootstrap failed", bootstrapError)
        setError("Your saved draft remains available so you can try again.")
        setStatus(navigator.onLine ? "error" : "offline")
      }
    }

    void bootstrapCase()
    return () => {
      controller.abort()
      clearTimeout(retryTimer)
    }
  }, [attempt, isLoaded, isSignedIn, router])

  if (status === "checking" || status === "importing") {
    return (
      <section className="gb-card w-full max-w-md p-8 text-center" role="status" aria-live="polite">
        <Loader2 className="mx-auto size-10 animate-spin text-primary" aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-semibold text-harbor-deep">Setting up your case</h1>
        <p className="mt-2 text-muted-foreground">Moving your saved draft into your private case workspace.</p>
      </section>
    )
  }

  if (status === "no_session") {
    return (
      <section className="gb-card w-full max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold text-harbor-deep">No saved draft found</h1>
        <p className="mt-3 text-muted-foreground">
          We couldn’t find a story saved in this browser tab, so no case was started. Add a new case to write your story.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild className="min-h-11 rounded-full">
            <Link href="/app/case/new">Add a new case</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11 rounded-full">
            <Link href="/app">My cases</Link>
          </Button>
        </div>
        <Link href="/faq" className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
          Get support
        </Link>
      </section>
    )
  }

  if (status === "offline" || error) {
    const isOffline = status === "offline"
    return (
      <section className="gb-card w-full max-w-md p-8 text-center" role="alert">
        {isOffline ? <WifiOff className="mx-auto size-10 text-harbor-warning" aria-hidden="true" /> : null}
        <h1 ref={errorRef} tabIndex={-1} className="text-2xl font-semibold text-harbor-deep outline-none">
          {isOffline ? "You're offline" : "We couldn’t start your case. Your saved draft is still here."}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {isOffline ? "Reconnect, then try again. Your saved draft will remain in this browser tab." : error}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            type="button"
            className="min-h-11 rounded-full"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </Button>
          <Button asChild variant="outline" className="min-h-11 rounded-full">
            <Link href="/app">My cases</Link>
          </Button>
        </div>
        <Link href="/faq" className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
          Get support
        </Link>
      </section>
    )
  }

  return <p className="text-muted-foreground" role="status">Opening your case…</p>
}