"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Clock,
  PhoneCall,
  FileText,
  Users,
  AlertTriangle,
  ShieldAlert,
  HelpCircle,
} from "lucide-react"
import Link from "next/link"
import { getSessionToken, getRouterSession, updateRouterSession } from "@/lib/router-session"
import type { TriagePath } from "@/lib/rules"

interface Assessment {
  triage_path: TriagePath
  srf_eligible: boolean
  fidrec_subscriber: boolean
  recommended_path: string
  eligibility_score: number
  success_probability: "high" | "medium" | "low"
  reasoning: string[]
  missing_info: string[]
  next_steps: string[]
  estimated_timeline: string
  deadline_warning: string | null
  bank_contact_days_elapsed: number | null
  is_fidrec_eligible: boolean
}

interface PathConfig {
  icon: React.ElementType
  iconColor: string
  headerBg: string
  badge: string
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  title: string
  description: string
  ctaText: string
  ctaHref: string
  ctaVariant: "default" | "outline"
}

function getPathConfig(assessment: Assessment, fiName: string | null): PathConfig {
  const fi = fiName ?? "your financial institution"

  switch (assessment.triage_path) {
    case "A":
      return {
        icon: ShieldAlert,
        iconColor: "text-accent",
        headerBg: "bg-accent/10",
        badge: "SRF-Eligible",
        badgeVariant: "default",
        title: "Your case may qualify for a refund under Singapore law",
        description: `The Shared Responsibility Framework (SRF) may require ${fi} to compensate you. We'll help you assess the bank's specific duties and build your case.`,
        ctaText: "Start building my case",
        ctaHref: "/auth/sign-up?source=router&path=A",
        ctaVariant: "default",
      }
    case "A2":
      return {
        icon: PhoneCall,
        iconColor: "text-primary",
        headerBg: "bg-primary/10",
        badge: "Telco Complaint (IMDA)",
        badgeVariant: "secondary",
        title: "The telco may bear responsibility for this scam",
        description:
          "If your bank met all its SRF duties, Singapore's Shared Responsibility Framework places liability on the telco for failing to block fraudulent SMS sender IDs. We'll guide you on filing a complaint with IMDA.",
        ctaText: "See IMDA complaint guide",
        ctaHref: "/router/path-a2",
        ctaVariant: "default",
      }
    case "B":
      return {
        icon: CheckCircle,
        iconColor: "text-accent",
        headerBg: "bg-accent/10",
        badge: "FIDReC-Eligible",
        badgeVariant: "default",
        title: "You may be eligible to file with FIDReC",
        description: `Your dispute with ${fi} appears ready for formal escalation. FIDReC is Singapore's independent dispute resolution body — filing is free.`,
        ctaText: "Build my FIDReC submission",
        ctaHref: "/auth/sign-up?source=router&path=B",
        ctaVariant: "default",
      }
    case "C":
      return {
        icon: Clock,
        iconColor: "text-primary",
        headerBg: "bg-primary/10",
        badge: "4-Week Waiting Period",
        badgeVariant: "secondary",
        title: "You're on the right path — just a little early",
        description:
          "FIDReC requires you to give your bank 4 weeks to respond before escalating. Use this time to build your evidence and we'll remind you when you're ready to file.",
        ctaText: "Set up my 4-week tracker",
        ctaHref: "/router/tracker",
        ctaVariant: "default",
      }
    case "D":
      return {
        icon: HelpCircle,
        iconColor: "text-muted-foreground",
        headerBg: "bg-muted",
        badge: "Alternative Paths",
        badgeVariant: "outline",
        title: "We'll guide you to the right channel",
        description:
          "FIDReC may not be the right path for your situation — but there are other options. We'll show you what's available and what to expect from each.",
        ctaText: "See my options",
        ctaHref: "#options",
        ctaVariant: "outline",
      }
    case "E":
      return {
        icon: AlertCircle,
        iconColor: "text-destructive",
        headerBg: "bg-destructive/10",
        badge: "Limited Formal Recourse",
        badgeVariant: "destructive",
        title: "Formal recovery is difficult — but not hopeless",
        description:
          "Cryptocurrency and overseas platforms have very limited formal recovery routes in Singapore. We'll be honest about what's realistic and guide you on the best available steps.",
        ctaText: "See my options",
        ctaHref: "/router/path-e",
        ctaVariant: "outline",
      }
  }
}

function PathDOptions({ assessment }: { assessment: Assessment }) {
  if (assessment.triage_path !== "D") return null
  return (
    <div id="options" className="space-y-3 pt-2">
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Available paths</h3>
      {[
        {
          label: "MAS Financial Consumers Alert",
          desc: "Check if your FI is MAS-licensed and file a complaint with MAS.",
          href: "https://www.mas.gov.sg/consumer-complaints",
        },
        {
          label: "CASE — Consumers Association of Singapore",
          desc: "For e-commerce and consumer disputes.",
          href: "https://www.case.org.sg",
        },
        {
          label: "Small Claims Tribunal",
          desc: "For disputes up to S$20,000 against a person or business you can identify.",
          href: "https://www.judiciary.gov.sg/civil/small-claims-tribunals",
        },
        {
          label: "Pro Bono SG — Free Legal Clinics",
          desc: "Get free legal advice from a volunteer lawyer.",
          href: "https://probono.sg",
        },
      ].map((item) => (
        <a
          key={item.label}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start justify-between gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors"
        >
          <div>
            <p className="font-medium text-sm">{item.label}</p>
            <p className="text-xs text-muted-foreground">{item.desc}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        </a>
      ))}
    </div>
  )
}

function PathCTracker({ daysElapsed }: { daysElapsed: number | null }) {
  if (daysElapsed === null) return null
  const pct = Math.min(100, Math.round((daysElapsed / 28) * 100))
  const daysLeft = Math.max(0, 28 - daysElapsed)
  return (
    <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl space-y-2">
      <div className="flex justify-between text-sm font-medium">
        <span>4-week waiting period</span>
        <span>{daysLeft > 0 ? `${daysLeft} days left` : "Ready to escalate"}</span>
      </div>
      <Progress value={pct} className="h-2" />
      <p className="text-xs text-muted-foreground">Day {daysElapsed} of 28 — contact your bank if you haven't already and keep all reference numbers.</p>
    </div>
  )
}

function CrisisFooter() {
  return (
    <div className="text-center text-xs text-muted-foreground space-y-1 pt-4 border-t border-border/50">
      <p className="font-medium">Need immediate support?</p>
      <p>
        Samaritans of Singapore (SOS):{" "}
        <a href="tel:1767" className="underline">
          1767
        </a>{" "}
        · SAGE Counselling:{" "}
        <a href="tel:18005555555" className="underline">
          1800-555-5555
        </a>{" "}
        · National Care Hotline:{" "}
        <a href="tel:18002026868" className="underline">
          1800-202-6868
        </a>
      </p>
    </div>
  )
}

export default function ResultsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [classification, setClassification] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const loadResults = async () => {
      try {
        const sessionToken = getSessionToken()
        if (!sessionToken) {
          router.push("/router")
          return
        }

        const session = await getRouterSession(sessionToken)
        if (!session || !session.classification_result) {
          router.push("/router")
          return
        }
        setClassification(session.classification_result as Record<string, unknown>)

        const response = await fetch("/api/router/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_token: sessionToken,
            classification: session.classification_result,
            responses: session.user_responses ?? {},
          }),
        })

        if (!response.ok) throw new Error("Assessment failed")

        const result = (await response.json()) as Assessment
        setAssessment(result)

        // Persist to session
        await updateRouterSession(sessionToken, {
          eligibility_assessment: result as unknown as Record<string, unknown>,
          recommended_path: result.recommended_path as
            | "fidrec_eligible"
            | "waitlist"
            | "self_service"
            | "not_eligible",
        })
      } catch (err) {
        console.error("[results] Error:", err)
        setError("Something went wrong. Please try again.")
      } finally {
        setIsLoading(false)
      }
    }

    loadResults()
  }, [router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Analysing your situation...</p>
        </div>
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-center">Assessment Error</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">{error ?? "Unable to complete assessment"}</p>
            <Button onClick={() => router.push("/router")} className="w-full">
              Start Over
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const fiName = typeof classification?.fi_name === "string" ? classification.fi_name : null
  const distressSignals = classification?.distress_signals === true
  const pathConfig = getPathConfig(assessment, fiName)
  const PathIcon = pathConfig.icon

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="flex items-center gap-2 w-fit">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">GB</span>
            </div>
            <span className="font-semibold text-lg">GuideBuoy AI</span>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-10">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Deadline warning — shown prominently if urgent */}
          {assessment.deadline_warning && (
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 text-destructive p-4 rounded-xl">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{assessment.deadline_warning}</p>
            </div>
          )}

          {/* Main result card */}
          <Card className="shadow-lg rounded-xl overflow-hidden">
            <CardHeader className={pathConfig.headerBg}>
              <div className="flex justify-center mb-3">
                <PathIcon className={`h-14 w-14 ${pathConfig.iconColor}`} />
              </div>
              <div className="flex justify-center mb-2">
                <Badge variant={pathConfig.badgeVariant}>{pathConfig.badge}</Badge>
              </div>
              <CardTitle className="text-center text-2xl text-balance">{pathConfig.title}</CardTitle>
              <CardDescription className="text-center text-base text-pretty mt-1">
                {pathConfig.description}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              {/* Case strength */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Case strength</span>
                  <Badge
                    variant={assessment.success_probability === "high" ? "default" : "secondary"}
                    className={assessment.success_probability === "high" ? "bg-accent text-accent-foreground" : ""}
                  >
                    {assessment.success_probability.toUpperCase()}
                  </Badge>
                </div>
                <Progress value={assessment.eligibility_score} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">{assessment.eligibility_score} / 100</p>
              </div>

              {/* Path C tracker */}
              {assessment.triage_path === "C" && (
                <PathCTracker daysElapsed={assessment.bank_contact_days_elapsed} />
              )}

              {/* Reasoning */}
              <div>
                <h3 className="font-semibold mb-3">Why this path</h3>
                <ul className="space-y-2">
                  {assessment.reasoning.map((reason, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Missing info */}
              {assessment.missing_info.length > 0 && (
                <div className="bg-muted/60 p-4 rounded-xl">
                  <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    Information that would help strengthen your case
                  </h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {assessment.missing_info.map((info, i) => (
                      <li key={i}>• {info}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next steps */}
              <div>
                <h3 className="font-semibold mb-3">What to do now</h3>
                <ol className="space-y-2">
                  {assessment.next_steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Path D sub-options */}
              <PathDOptions assessment={assessment} />

              {/* Timeline */}
              <div className="bg-muted/50 p-4 rounded-xl">
                <h3 className="font-semibold mb-1 text-sm">Expected timeline</h3>
                <p className="text-sm text-muted-foreground">{assessment.estimated_timeline}</p>
              </div>

              {/* Primary CTA */}
              {assessment.triage_path !== "D" && (
                <Button asChild size="lg" variant={pathConfig.ctaVariant} className="w-full rounded-full">
                  <Link href={pathConfig.ctaHref}>
                    {pathConfig.ctaText}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
              )}

              {/* Helper invite — surfaced proactively for distress signals */}
              {(distressSignals || assessment.triage_path === "A" || assessment.triage_path === "B") && (
                <div className="border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">Would you like help from someone you trust?</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You can invite a family member or friend to help you through this process — it&apos;s free.
                  </p>
                  <Button asChild variant="outline" size="sm" className="rounded-full">
                    <Link href="/auth/sign-up?source=router&helper=true">Invite a helper</Link>
                  </Button>
                </div>
              )}

              <p className="text-xs text-center text-muted-foreground">
                Your assessment is saved. You can return anytime to continue.
              </p>
            </CardContent>
          </Card>

          {/* Secondary actions */}
          <Card className="rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Other options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Button
                variant="outline"
                className="w-full justify-between bg-transparent rounded-full"
                asChild
              >
                <Link href="/router">
                  <span>Start a new assessment</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between bg-transparent rounded-full"
                asChild
              >
                <Link href="/faq">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Read our FAQ
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Legal disclaimer */}
          <p className="text-xs text-center text-muted-foreground px-4">
            GuideBuoy AI is not a law firm and does not provide legal advice. This assessment is for
            guidance only. For professional legal advice, contact{" "}
            <a href="https://probono.sg" target="_blank" rel="noopener noreferrer" className="underline">
              Pro Bono SG
            </a>
            .
          </p>

          <CrisisFooter />
        </div>
      </div>
    </div>
  )
}
