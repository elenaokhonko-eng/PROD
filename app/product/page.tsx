import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
} from "lucide-react"
import { marketingNavLinks } from "@/lib/navigation"

export const metadata: Metadata = {
  title: "GuideBuoy AI Product – Complaint Automation Platform",
  description:
    "Explore the GuideBuoy AI platform: complaint intake, AI report builder, document automation, and the FIDReC-ready workflow powering guidebuoyai.sg.",
}

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

const deliveryStages = [
  {
    title: "MVP (live now)",
    period: "Q1 2025",
    bullets: ["Router intake + AI summaries", "Document automation pack", "Stripe monetisation"],
  },
  {
    title: "Beta programme",
    period: "Q2 2025",
    bullets: ["Nominee workspace", "Hearing bundle compiler", "Institution messaging plugins"],
  },
  {
    title: "Public launch",
    period: "Q3 2025",
    bullets: ["Regional playbooks", "Analytics dashboard", "3rd-party API access"],
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

export default function ProductPage() {
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
              GuideBuoy AI is a web-native case platform running on Next.js, Supabase, Stripe, and Render. It combines
              AI-generated guidance with deterministic workflows so consumers can submit FIDReC-ready cases faster and
              with higher-quality evidence.
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
                  <p className="text-2xl font-semibold text-foreground">99.2%</p>
                  <p>Successful document generation rate across 1,800+ case packs.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Gauge className="h-10 w-10 text-primary" />
                <div>
                  <p className="text-2xl font-semibold text-foreground">6 mins</p>
                  <p>Average time from intake to first actionable recommendation.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Layers className="h-10 w-10 text-primary" />
                <div>
                  <p className="text-2xl font-semibold text-foreground">Single codebase</p>
                  <p>Same stack powers guidebuoyai.sg production and partner pilots.</p>
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

        <section>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-2xl font-semibold">Product showcase</h2>
            <span className="text-sm text-muted-foreground">Static previews of the live platform</span>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {showcasePanels.map((panel) => (
              <Card key={panel.title} className="overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-lg">{panel.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{panel.description}</p>
                </CardHeader>
                <CardContent>
                  <div
                    className={`rounded-2xl border border-dashed border-border/60 bg-gradient-to-br ${panel.accent} p-6 text-sm text-muted-foreground`}
                  >
                    <p className="font-medium text-foreground mb-2">UI snapshot</p>
                    <p>
                      This static panel mirrors the actual screen in our app, built with Tailwind + shadcn/ui, connected
                      to Supabase auth and storage.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle>Security & compliance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Supabase auth with RLS, encrypted storage buckets, and field-level audit logs.</p>
              <p>All emails routed through verified SMTP with DKIM/SPF alignment, logged via Logflare.</p>
              <p>Stripe + webhooks for payments, with preview keys swapped for live keys at deploy time.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Roadmap signals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Opening API endpoints so regulated partners can push decision letters directly into the GuideBuoy workspace.</p>
              <p>Launching structured complaint analytics for regulators to monitor scam patterns (opt-in, aggregated).</p>
              <p>Extending the router to Bahasa Indonesia and Bahasa Melayu to support caregivers across ASEAN.</p>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
