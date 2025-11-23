import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createServiceClient } from "@/lib/supabase/service"
import {
  Sparkles,
  ClipboardList,
  ShieldCheck,
  Clock,
  Bot,
  FileText,
  Users,
  BarChart3,
  Gauge,
  Layers,
  Headphones,
  Building2,
} from "lucide-react"
import { marketingNavLinks } from "@/lib/navigation"

export const metadata: Metadata = {
  title: "GuideBuoy AI Product – Complaint Automation Platform",
  description:
    "Explore the GuideBuoy AI platform: complaint intake, AI report builder, document automation, and the FIDReC-ready workflow powering guidebuoyai.sg.",
}

export const revalidate = 300

type PlatformSnapshot = {
  docGenerationRate: number
  casePacks: number
  avgTimeToRecommendationMinutes: number
  codebaseNote: string
}

const defaultPlatformSnapshot: PlatformSnapshot = {
  docGenerationRate: 99.2,
  casePacks: 1800,
  avgTimeToRecommendationMinutes: 6,
  codebaseNote: "Same stack powers guidebuoyai.sg production and partner pilots.",
}

async function getPlatformSnapshot(): Promise<PlatformSnapshot> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("platform_snapshot")
      .select("doc_generation_rate,case_packs,avg_time_to_recommendation_minutes,codebase_note,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error("[product] platform_snapshot fetch error:", error.message)
      return defaultPlatformSnapshot
    }

    return {
      docGenerationRate: data?.doc_generation_rate ?? defaultPlatformSnapshot.docGenerationRate,
      casePacks: data?.case_packs ?? defaultPlatformSnapshot.casePacks,
      avgTimeToRecommendationMinutes:
        data?.avg_time_to_recommendation_minutes ?? defaultPlatformSnapshot.avgTimeToRecommendationMinutes,
      codebaseNote: data?.codebase_note ?? defaultPlatformSnapshot.codebaseNote,
    }
  } catch (err) {
    console.error("[product] platform_snapshot unexpected error:", err)
    return defaultPlatformSnapshot
  }
}

const formatNumber = (value: number) => new Intl.NumberFormat("en-SG").format(value)

const productHighlights = [
  {
    title: "AI intake engine",
    description: "Speech-to-text, scam classification, and structured questions that capture the full story in minutes.",
    icon: ClipboardList,
  },
  {
    title: "Case builder workspace",
    description: "Structured evidence tables, liability theories, and recommended next steps backed by precedent data.",
    icon: Bot,
  },
  {
    title: "Document automation",
    description: "Complaint letters, FIR drafts, and FIDReC bundles with auto-numbered exhibits and citations.",
    icon: FileText,
  },
  {
    title: "Live case tracker",
    description: "Deadline tracking, reminder emails, and outcome logging for each stage of the FIDReC process.",
    icon: Clock,
  },
  {
    title: "Collaboration layer",
    description: "Invite helpers or nominees with role-based permissions and audit trails.",
    icon: Users,
  },
  {
    title: "Evidence vault",
    description: "Supabase storage with signed URLs, checksum validation, and PDPA-grade access controls.",
    icon: ShieldCheck,
  },
]

const reportHubModules = [
  {
    badge: "Module 1",
    title: "Your story, organised",
    description: "We turn your voice note or typed story into a clear report you can edit anytime.",
    details: "It stays in plain language and grows into a police-ready report when you need it.",
    icon: Sparkles,
  },
  {
    badge: "Module 2",
    title: "Evidence checklist",
    description: "See what proof is missing at a glance.",
    details: "Upload screenshots, bank slips, or reference numbers right next to the list.",
    icon: ClipboardList,
  },
  {
    badge: "Module 3",
    title: "Share once, reuse it",
    description: "Download a police-ready PDF or a short summary for yourself.",
    details: "When partners are live, you can send the same report to them with one tap.",
    icon: FileText,
  },
  {
    badge: "Module 4",
    title: "Next steps you can trust",
    description: "A short to-do list tells you what to do now and what can wait.",
    details: "Priority tags keep you calm and moving.",
    icon: ShieldCheck,
  },
  {
    badge: "Module 5",
    title: "Get help if you need it",
    description: "Ask for a pro-bono clinic or talk to a specialist for bigger losses.",
    details: "The helper stays free; add paid help only if you choose.",
    icon: Headphones,
  },
  {
    badge: "Module 6",
    title: "Privacy and control",
    description: "You decide who sees your information.",
    details: "Every action is logged with consent, and you can delete your report anytime.",
    icon: Building2,
  },
]

const shareMenu = [
  {
    title: "Official reports",
    description: "Download a police-ready pack or a simple summary you can file yourself.",
    actions: ["Download police-ready PDF", "Save a quick summary"],
    status: "active",
  },
  {
    title: "Partner channels",
    description: "Send packets directly to partners as they come online. Live partners show an active button.",
    actions: ["Send to pilot partner", "Send to FIDReC (when ready)"],
    status: "pilot",
  },
  {
    title: "For businesses",
    description: "Templates for SMEs and regulators are coming next.",
    actions: ["SME complaint packet", "Small Claims summary"],
    status: "comingSoon",
  },
]

const nextStepsList = [
  {
    priority: "Do now",
    action: "File your report on the SPF e-services portal.",
  },
  {
    priority: "Do now",
    action: "Call your bank's emergency line to pause your card or account.",
  },
  {
    priority: "Do soon",
    action: "Log the scam with ScamShield so others stay safe.",
  },
  {
    priority: "If needed",
    action: "If the first response doesn't solve it, escalate to FIDReC from the hub.",
  },
]

const deliveryStages = [
  {
    title: "MVP (live now)",
    period: "Q4 2025",
    bullets: ["Router intake + AI summaries", "Document automation pack"],
  },
  {
    title: "Beta SME partners programme",
    period: "Q1 2026",
    bullets: ["Helper workspace (pro-bono clinics or nominees)", "Institution messaging APIs"],
  },
  {
    title: "Public launch",
    period: "Q2 2026",
    bullets: ["Complaint playbooks", "Complaints Analytics dashboard", "3rd-party API access"],
  },
]

const showcasePanels = [
  {
    title: "Dispute cockpit",
    description: "One view of intake progress, risk flags, and Stripe plan details for every user.",
    accent: "from-primary/20 via-primary/5 to-transparent",
  },
  {
    title: "Evidence timeline",
    description: "Chronological view of transfers, call logs, and attachments synced from Supabase storage.",
    accent: "from-emerald-200/40 via-background to-transparent",
  },
  {
    title: "FIDReC prep kit",
    description: "Auto-filled forms, email drafts, and checklists generated from the AI case model.",
    accent: "from-amber-200/40 via-background to-transparent",
  },
]

export default async function ProductPage() {
  const snapshot = await getPlatformSnapshot()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-muted-foreground">
                {marketingNavLinks.map((item) => (
                  <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                    {item.label}
                  </Link>
                ))}
              </nav>
              <Badge variant="secondary" className="hidden sm:inline-flex rounded-full">
                Free Helper Access
              </Badge>
              <Link href="/auth/login">
                <Button variant="outline" size="sm" className="rounded-full bg-transparent">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 space-y-12">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_minmax(0,0.9fr)] items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Badge variant="outline" className="rounded-full">
                SaaS Platform
              </Badge>
              <Badge variant="outline" className="rounded-full">
                MVP live • Beta recruiting
              </Badge>
            </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4 text-balance">
            Software built for Singapore’s complaint resolution network
          </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              GuideBuoy AI is an AXS-style complaints hub built on Next.js, Supabase, Stripe, and Render. It turns one
              Singapore story plus supporting documents into reusable, partner-ready reports with calm, guided steps.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <Button asChild className="rounded-full">
                <Link href="/auth/sign-up?source=product">Start free intake</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="mailto:partners@guidebuoyai.sg">Book a product tour</Link>
              </Button>
            </div>
          </div>
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle>Platform snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-3">
                <Sparkles className="h-10 w-10 text-primary" />
                <div>
                  <p className="text-2xl font-semibold text-foreground">{snapshot.docGenerationRate}%</p>
                  <p>Successful document generation rate across {formatNumber(snapshot.casePacks)} case packs.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Gauge className="h-10 w-10 text-primary" />
                <div>
                  <p className="text-2xl font-semibold text-foreground">
                    {snapshot.avgTimeToRecommendationMinutes} mins
                  </p>
                  <p>Average time from intake to first actionable recommendation.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Layers className="h-10 w-10 text-primary" />
                <div>
                  <p className="text-2xl font-semibold text-foreground">Single codebase</p>
                  <p>{snapshot.codebaseNote}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-6">What users get today</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {productHighlights.map((highlight) => {
              const Icon = highlight.icon
              return (
                <Card key={highlight.title} className="h-full">
                  <CardHeader className="flex flex-row items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{highlight.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">{highlight.description}</CardContent>
                </Card>
              )
            })}
          </div>
        </section>

        <section className="space-y-8">
          <div className="space-y-2">
            <Badge variant="secondary" className="w-fit rounded-full">
              Report Hub
            </Badge>
            <h2 className="text-2xl font-semibold">Everything lives in your Report Hub</h2>
            <p className="text-muted-foreground max-w-3xl">
              After you share what happened, the helper keeps your story, evidence, and next steps together so you never
              feel lost.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {reportHubModules.map((module) => {
              const Icon = module.icon
              return (
                <Card key={module.title} className="h-full border-border/70">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{module.badge}</p>
                        <CardTitle className="text-lg">{module.title}</CardTitle>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-2">
                    <p>{module.description}</p>
                    <p>{module.details}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-border/70 h-full">
              <CardHeader>
                <Badge variant="secondary" className="w-fit rounded-full">
                  Share & download
                </Badge>
                <CardTitle>Report once, reuse it</CardTitle>
                <CardDescription>Keep one tidy report and use it wherever you need without retyping anything.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {shareMenu.map((option) => (
                  <div key={option.title} className="rounded-xl border border-border/60 p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-semibold text-foreground">{option.title}</p>
                        <p className="text-sm text-muted-foreground">{option.description}</p>
                      </div>
                      <span
                        className={`text-xs font-semibold px-3 py-1 rounded-full ${
                          option.status === "active"
                            ? "bg-emerald-100 text-emerald-900"
                            : option.status === "pilot"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-border text-muted-foreground"
                        }`}
                      >
                        {option.status === "active" && "Ready now"}
                        {option.status === "pilot" && "Live soon"}
                        {option.status === "comingSoon" && "Coming soon"}
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                      {option.actions.map((action) => (
                        <li key={action}>- {action}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-border/70 h-full">
              <CardHeader>
                <Badge variant="secondary" className="w-fit rounded-full">
                  Next steps
                </Badge>
                <CardTitle>Know what to do next</CardTitle>
                <CardDescription>A calm checklist based on your answers.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {nextStepsList.map((step) => (
                  <div key={step.action} className="rounded-xl border border-dashed border-border/70 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{step.priority}</p>
                    <p className="font-medium text-foreground mt-1">{step.action}</p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Each action is saved with your consent so you stay in control.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {deliveryStages.map((stage) => (
            <Card key={stage.title} className="h-full">
              <CardHeader>
                <Badge variant="outline" className="w-fit rounded-full">
                  {stage.period}
                </Badge>
                <CardTitle className="text-xl">{stage.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                  {stage.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </section>

      </main>
    </div>
  )
}
