"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, ArrowRight, CheckCircle, ExternalLink, FileText, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"
import { getRouterSession, getSessionToken } from "@/lib/router-session"

const INFORMATION_TO_KEEP = [
  {
    title: "Use the institution's official complaints channel",
    body: "Keep the acknowledgement, complaint reference and the contact details you used.",
  },
  {
    title: "Organise copies of relevant records",
    body: "Keep transaction records, messages, screenshots and correspondence together. Keep originals unchanged where possible.",
  },
  {
    title: "Check current external-escalation requirements",
    body: "Requirements can change and depend on the circumstances. Confirm the current process directly with FIDReC.",
  },
] as const

export default function TrackerPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [bankContacted, setBankContacted] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errorHeadingRef = useRef<HTMLHeadingElement>(null)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    const loadSession = async () => {
      try {
        const token = getSessionToken()
        if (!token) {
          router.replace("/router")
          return
        }

        const session = await getRouterSession(token)
        if (!session) {
          router.replace("/router")
          return
        }

        const classification = session.classification_result as Record<string, unknown> | null
        if (!cancelled) {
          setBankContacted(typeof classification?.bank_contacted === "boolean" ? classification.bank_contacted : null)
        }
      } catch (loadError) {
        console.error("[tracker] Error:", loadError)
        if (!cancelled) setError("This information could not be loaded. Check your connection and try again.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadSession()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    if (error) errorHeadingRef.current?.focus()
  }, [error])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main id="main-content" className="gb-container flex min-h-[70vh] items-center justify-center py-12">
          <div role="status" aria-live="polite" className="text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-primary" aria-hidden="true" />
            <p className="mt-3 text-muted-foreground">Loading your saved information…</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main id="main-content" className="gb-container flex min-h-[70vh] items-center justify-center py-12">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <AlertCircle className="mx-auto size-10 text-destructive" aria-hidden="true" />
              <h1 ref={errorHeadingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">Information unavailable</h1>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p role="alert" className="text-muted-foreground">{error}</p>
              <Button onClick={() => router.push("/router/results")} className="w-full">Return to my result</Button>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main id="main-content" className="gb-container py-8 sm:py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <header className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Financial-institution response</p>
            <h1 className="mt-3 text-3xl font-semibold text-harbor-deep sm:text-4xl">Keep your complaint records together</h1>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
              GuideBuoy does not calculate a filing date or decide when an external complaint can be made. Confirm the current requirements directly with the relevant organisation.
            </p>
          </header>

          <Card>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-start gap-3 rounded-xl bg-primary/5 p-4">
                <CheckCircle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h2 className="font-semibold">Your saved answer</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {bankContacted === true
                      ? "Your complaint-path answers record that you contacted the financial institution. Keep its acknowledgement and reference number."
                      : bankContacted === false
                        ? "Your complaint-path answers record that you have not contacted the financial institution. Use its verified contact details if you decide to make a complaint."
                        : "Your saved answers do not confirm whether the financial institution has been contacted."}
                  </p>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground" role="note">
                This is a summary of your answer, not confirmation that any waiting period or filing requirement has been met.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="text-lg font-semibold">Information to keep</h2></CardHeader>
            <CardContent className="space-y-5">
              {INFORMATION_TO_KEEP.map((item, index) => (
                <div key={item.title} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{index + 1}</span>
                  <div>
                    <h3 className="font-medium">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button asChild><a href="https://www.fidrec.com.sg/" target="_blank" rel="noopener noreferrer">Check FIDReC guidance<ExternalLink className="ml-2 size-4" aria-hidden="true" /></a></Button>
            <Button asChild variant="outline"><Link href="/router/results">Back to my result<ArrowRight className="ml-2 size-4" aria-hidden="true" /></Link></Button>
          </div>

          <Button asChild variant="ghost" className="w-full"><Link href="/resources"><FileText className="mr-2 size-4" aria-hidden="true" />Browse official resources</Link></Button>

          <p className="text-center text-xs leading-5 text-muted-foreground">
            GuideBuoy helps organise information. It does not decide your case or provide legal advice.
          </p>
        </div>
      </main>
    </div>
  )
}
