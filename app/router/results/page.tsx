"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  HelpCircle,
  Loader2,
  PhoneCall,
  ShieldAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"
import { getRouterSession, getSessionToken, updateRouterSession } from "@/lib/router-session"
import type { TriagePath } from "@/lib/rules"

interface Assessment {
  triage_path: TriagePath
  recommended_path: "fidrec_eligible" | "waitlist" | "self_service" | "not_eligible"
  [key: string]: unknown
}

interface PathConfig {
  icon: React.ElementType
  iconColor: string
  headerBg: string
  badge: string
  badgeVariant: "default" | "secondary" | "outline"
  title: string
  description: string
  ctaText: string
  ctaHref: string
  ctaVariant: "default" | "outline"
  notes: string[]
}

function getPathConfig(path: TriagePath, fiName: string | null): PathConfig {
  const financialInstitution = fiName ?? "your financial institution"

  switch (path) {
    case "A":
      return {
        icon: ShieldAlert,
        iconColor: "text-accent",
        headerBg: "bg-accent/10",
        badge: "SRF information",
        badgeVariant: "default",
        title: "The SRF may be relevant",
        description: `Your answers suggest that the Shared Responsibility Framework may be worth discussing with ${financialInstitution} or an independent adviser. This is not an eligibility or outcome decision.`,
        ctaText: "Start organising my case",
        ctaHref: "/onboarding",
        ctaVariant: "default",
        notes: [
          "Use the institution's official contact details to report the incident.",
          "Keep copies of messages, transaction records and correspondence.",
          "Check the current framework and dispute requirements on official websites.",
        ],
      }
    case "A2":
      return {
        icon: PhoneCall,
        iconColor: "text-primary",
        headerBg: "bg-primary/10",
        badge: "Telecommunications information",
        badgeVariant: "secondary",
        title: "An IMDA information route may be relevant",
        description:
          "Your answers suggest that telecommunications controls may be relevant. Review current IMDA guidance before deciding what to do next.",
        ctaText: "Review the information route",
        ctaHref: "/router/path-a2",
        ctaVariant: "default",
        notes: [
          "Keep the original messages and sender details.",
          "Use official reporting channels and verify their current requirements.",
          "Record any reference numbers you receive.",
        ],
      }
    case "B":
      return {
        icon: CheckCircle,
        iconColor: "text-accent",
        headerBg: "bg-accent/10",
        badge: "FIDReC information",
        badgeVariant: "default",
        title: "A FIDReC route may be relevant",
        description: `Your answers suggest that a formal dispute involving ${financialInstitution} may be worth reviewing. Confirm current eligibility and filing requirements directly with FIDReC.`,
        ctaText: "Start organising my case",
        ctaHref: "/onboarding",
        ctaVariant: "default",
        notes: [
          "Keep the institution's written response and reference numbers.",
          "Organise transaction records and correspondence.",
          "Confirm current requirements directly with FIDReC.",
        ],
      }
    case "C":
      return {
        icon: Clock,
        iconColor: "text-primary",
        headerBg: "bg-primary/10",
        badge: "Institution response",
        badgeVariant: "secondary",
        title: "Contact the financial institution first",
        description:
          "Current dispute guidance may require the financial institution to consider the complaint before an external escalation. The applicable requirements depend on the circumstances, so confirm them on the official FIDReC website.",
        ctaText: "Review what to keep",
        ctaHref: "/router/tracker",
        ctaVariant: "default",
        notes: [
          "Use the institution's official complaints channel.",
          "Keep written acknowledgements and reference numbers.",
          "Check current escalation requirements directly with FIDReC.",
        ],
      }
    case "D":
      return {
        icon: HelpCircle,
        iconColor: "text-muted-foreground",
        headerBg: "bg-muted",
        badge: "Other information routes",
        badgeVariant: "outline",
        title: "Review other official channels",
        description:
          "FIDReC may not be the relevant route for this situation. Official organisations can explain their current remit and requirements.",
        ctaText: "Browse official resources",
        ctaHref: "/resources",
        ctaVariant: "outline",
        notes: [
          "Use official websites to identify the relevant reporting channel.",
          "Keep a copy of what happened and any supporting records.",
          "Consider independent professional advice where appropriate.",
        ],
      }
    case "E":
      return {
        icon: AlertCircle,
        iconColor: "text-destructive",
        headerBg: "bg-destructive/10",
        badge: "Reporting information",
        badgeVariant: "outline",
        title: "Review official reporting options",
        description:
          "Overseas-platform and cryptocurrency incidents can involve several organisations. Review current official reporting and account-protection information before choosing a next step.",
        ctaText: "See official options",
        ctaHref: "/router/path-e",
        ctaVariant: "outline",
        notes: [
          "Protect affected accounts using verified contact details.",
          "Keep transaction records, messages and platform details.",
          "Check current reporting guidance on official websites.",
        ],
      }
  }
}

export default function ResultsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [classification, setClassification] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errorHeadingRef = useRef<HTMLHeadingElement>(null)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    const loadResults = async () => {
      try {
        const sessionToken = getSessionToken()
        if (!sessionToken) {
          router.replace("/router")
          return
        }

        const session = await getRouterSession(sessionToken)
        if (!session?.classification_result) {
          router.replace("/router")
          return
        }

        if (cancelled) return
        const savedClassification = session.classification_result as Record<string, unknown>
        setClassification(savedClassification)

        const response = await fetch("/api/router/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_token: sessionToken,
            classification: savedClassification,
            responses: session.user_responses ?? {},
          }),
        })

        if (!response.ok) throw new Error("Assessment failed")

        const result = (await response.json()) as Assessment
        if (cancelled) return
        setAssessment(result)

        await updateRouterSession(sessionToken, {
          eligibility_assessment: result,
          recommended_path: result.recommended_path,
        })
      } catch (loadError) {
        console.error("[results] Error:", loadError)
        if (!cancelled) setError("The complaint-path check could not be completed. Check your connection and try again.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadResults()
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
          <div className="text-center" role="status" aria-live="polite">
            <Loader2 className="mx-auto size-8 animate-spin text-primary" aria-hidden="true" />
            <p className="mt-3 text-muted-foreground">Checking possible information routes…</p>
          </div>
        </main>
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main id="main-content" className="gb-container flex min-h-[70vh] items-center justify-center py-12">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <AlertCircle className="mx-auto size-10 text-destructive" aria-hidden="true" />
              <h1 ref={errorHeadingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
                The check could not be completed
              </h1>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-muted-foreground" role="alert">{error ?? "The result is not available."}</p>
              <Button onClick={() => router.push("/router")} className="w-full">Return to the complaint check</Button>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const fiName = typeof classification?.fi_name === "string" ? classification.fi_name : null
  const pathConfig = getPathConfig(assessment.triage_path, fiName)
  const PathIcon = pathConfig.icon

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main id="main-content" className="gb-container py-8 sm:py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <Card className="overflow-hidden shadow-lg">
            <CardHeader className={pathConfig.headerBg}>
              <PathIcon className={`mx-auto size-12 ${pathConfig.iconColor}`} aria-hidden="true" />
              <div className="mt-2 text-center"><Badge variant={pathConfig.badgeVariant}>{pathConfig.badge}</Badge></div>
              <h1 className="mt-2 text-center text-2xl font-semibold text-balance sm:text-3xl">{pathConfig.title}</h1>
              <p className="mx-auto mt-1 max-w-xl text-center text-sm leading-6 text-muted-foreground sm:text-base">
                {pathConfig.description}
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground" role="note">
                Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
              </p>

              <section aria-labelledby="next-information-heading">
                <h2 id="next-information-heading" className="font-semibold">Information to consider</h2>
                <ul className="mt-3 space-y-3">
                  {pathConfig.notes.map((note) => (
                    <li key={note} className="flex items-start gap-3 text-sm leading-6">
                      <CheckCircle className="mt-1 size-4 shrink-0 text-accent" aria-hidden="true" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <Button asChild size="lg" variant={pathConfig.ctaVariant} className="w-full">
                <Link href={pathConfig.ctaHref}>{pathConfig.ctaText}<ArrowRight className="ml-2 size-4" aria-hidden="true" /></Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="text-lg font-semibold">Other options</h2></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" asChild><Link href="/router">Start a new check</Link></Button>
              <Button variant="outline" asChild><Link href="/resources"><FileText className="mr-2 size-4" aria-hidden="true" />Official resources</Link></Button>
            </CardContent>
          </Card>

          <p className="px-4 text-center text-xs leading-5 text-muted-foreground">
            GuideBuoy helps organise information. It does not decide your case or provide legal advice.
          </p>
        </div>
      </main>
    </div>
  )
}
