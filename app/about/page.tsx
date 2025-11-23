import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail, Phone, MapPin, Linkedin, Target } from "lucide-react"
import { marketingNavLinks } from "@/lib/navigation"
import { createServiceClient } from "@/lib/supabase/service"

export const metadata: Metadata = {
  title: "About GuideBuoy AI – Team, Mission, and Contacts",
  description:
    "Meet the GuideBuoy AI founding team, learn about our complaint OS mission, and get in touch with the people building the FIDReC-focused platform.",
}

type TeamMember = {
  name: string
  role: string
  bio: string
  experience: string
  focus: string
  linkedIn: string
}

type Advisor = {
  name: string
  title: string
  summary: string
  linkedIn: string
}

const teamMembers: TeamMember[] = [
  {
    name: "Elena Okhonko",
    role: "Founder & CEO",
    bio: "Singaporean founder, licensed financial advisor, and ex-fund manager with 9+ years inside MAS-regulated institutions such as AIA and Mercer, plus a decade in large-scale software delivery.",
    experience:
      "Led PMO for US$56B AIA fixed-income portfolios, stewarded US$140M Fortune 500 transformation programmes, and previously drove CRM and product initiatives at Kraft Foods, Microsoft, and EPAM.",
    focus:
      "Combines regulatory fluency with enterprise-grade product management to ship complaint-tech that fits Singapore’s legal and compliance framework.",
    linkedIn: "https://www.linkedin.com/in/elenaokhonko",
  },
  {
    name: "Stepan Kropachev",
    role: "AI Chief Product Officer (CPO)",
    bio: "Italian-based product leader who has spent the last decade shipping AI copilots for compliance and wealth-tech platforms across Europe.",
    experience:
      "Previously led product for a Milan robo-advisor and co-authored the Responsible AI design playbook used by two EU fintech platforms.",
    focus: "Owns GuideBuoy’s product vision, model governance, and the Gemini-powered complaint workflow layer.",
    linkedIn: "https://www.linkedin.com/in/stepankropachev",
  },
  {
    name: "Maria Baranova",
    role: "Chief Financial & Data Officer (CFO & CDO)",
    bio: "Australian resident with twin backgrounds in structured finance and modern data stacks; keeps the company’s runway, pricing, and telemetry aligned.",
    experience:
      "Served as finance director for a Sydney insurtech scale-up and ran data governance programmes for two ASX-listed institutions.",
    focus: "Leads capital planning, cohort analytics, and PDPA-compliant data instrumentation for every product surface.",
    linkedIn: "https://www.linkedin.com/in/mariabaranova",
  },
  {
    name: "Ng Yuin Harng",
    role: "Govt. & Ecosystem Lead (Singapore)",
    bio: "Financial Services Director at FinArk Group @ PromiseLand who builds bridges with regulators, trade associations, and public-sector programmes.",
    experience:
      "15+ years advising retail investors and SMEs on regulated products; frequently consults on MAS sandboxes and FIDReC outreach.",
    focus: "Owns government partnerships, ecosystem onboarding, and the playbooks that align GuideBuoy with national trust initiatives.",
    linkedIn: "https://www.linkedin.com/in/yuinharng",
  },
]

const advisors: Advisor[] = [
  {
    name: "Sergey Anosov",
    title: "AI Tech & Model Advisor, CEO at Scade.pro",
    summary: "Guides our model selection, evaluation harnesses, and production rollout strategies for Gemini + custom LLMs.",
    linkedIn: "https://www.linkedin.com/in/sergeyanosov",
  },
  {
    name: "Federico Folcia",
    title: "Community Building GTM Advisor, CEO & Co-Founder at Crane Community Centers (Singapore)",
    summary: "Helps us embed GuideBuoy inside grassroots communities and design trust-centric go-to-market motions.",
    linkedIn: "https://www.linkedin.com/in/federicofolcia",
  },
  {
    name: "Greg Woolf",
    title: "AI Market Entry Strategist, INSEAD AI Venture Lab",
    summary: "Advises on cross-border AI commercialization and keeps our venture narrative aligned with institutional buyers.",
    linkedIn: "https://www.linkedin.com/in/gregorywoolf",
  },
]

const contactChannels = [
  {
    label: "General enquiries",
    value: "info@guidebuoyai.sg",
    href: "mailto:info@guidebuoyai.sg",
    icon: Mail,
  },
  {
    label: "Partnerships & pilot programmes",
    value: "partners@guidebuoyai.sg",
    href: "mailto:partners@guidebuoyai.sg",
    icon: Target,
  },
  {
    label: "Press & media",
    value: "+65 8800 2041",
    href: "tel:+6588002041",
    icon: Phone,
  },
  {
    label: "Registered office",
    value: "79 Ayer Rajah Crescent, #03-01, Singapore 139955",
    href: "https://maps.app.goo.gl/9mVvzQ5Mk2mfmSFK7",
    icon: MapPin,
  },
]

async function getCaseCounts() {
  const supabase = createServiceClient()
  const [{ count: totalCases }, { count: completedReports }] = await Promise.all([
    supabase.from("cases").select("*", { count: "exact", head: true }),
    supabase.from("cases").select("*", { count: "exact", head: true }).eq("status", "completed"),
  ])
  return {
    totalCases: totalCases ?? null,
    completedReports: completedReports ?? null,
  }
}

const formatNumber = (value: number | null) => (value === null ? "—" : new Intl.NumberFormat("en-SG").format(value))

export default async function AboutPage() {
  const { totalCases, completedReports } = await getCaseCounts()

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
            <Badge variant="outline" className="mb-4 rounded-full">
              AXS-style complaint helper
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight mb-4 text-balance">We are building Singapore&apos;s complaint OS</h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              GuideBuoy AI is a software company headquartered in Singapore. We design an end-to-end platform that helps
              residents, caregivers, and nominees prepare, submit, and manage agency-ready complaints (including FIDReC
              escalations) without legal representation. Everything we ship is cloud-delivered, PDPA-aligned, and battle-tested with real consumer complaint data.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <div className="rounded-2xl border border-border/60 p-4">
                <p className="text-3xl font-semibold">{formatNumber(totalCases)}</p>
                <p className="text-sm text-muted-foreground">case assessments started since Jan 2024</p>
              </div>
              <div className="rounded-2xl border border-border/60 p-4">
                <p className="text-3xl font-semibold">PDPA ✦ MAS</p>
                <p className="text-sm text-muted-foreground">every workflow reviewed by legal advisors</p>
              </div>
            </div>
          </div>
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle>Builder snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">Company</p>
                <p>GuideBuoy AI Pte. Ltd. (Singapore)</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Business model</p>
                <p>SaaS platform with complaint automation modules, premium case packs, and nominee services.</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Stage</p>
                <p>MVP launched Q1 2025, beta customers onboarded on guidebuoyai.sg, Stripe + Supabase stack in prod.</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Focus in 2025</p>
                <p>Grow payer conversion, deepen integrations with FIs, and expand to other ASEAN jurisdictions.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-2xl font-semibold">Core team</h2>
            <span className="text-sm text-muted-foreground">Experienced builders of fintech, legal-tech, and AI systems</span>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {teamMembers.map((member) => (
              <Card key={member.name} className="h-full">
                <CardHeader className="space-y-1">
                  <CardTitle>{member.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{member.role}</p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>{member.bio}</p>
                  <p>
                    <span className="text-foreground font-medium">Highlights: </span>
                    {member.experience}
                  </p>
                  <p>
                    <span className="text-foreground font-medium">Current focus: </span>
                    {member.focus}
                  </p>
                  <Link
                    href={member.linkedIn}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-foreground font-medium hover:underline"
                  >
                    <Linkedin className="h-4 w-4" /> LinkedIn
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>GuideBuoy AI SG Advisory Team</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              {advisors.map((advisor) => (
                <div key={advisor.name} className="border-b border-border/40 pb-4 last:border-b-0 last:pb-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-foreground font-medium">{advisor.name}</p>
                    <Link
                      href={advisor.linkedIn}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-foreground hover:underline text-xs font-medium"
                    >
                      <Linkedin className="h-3.5 w-3.5" />
                      LinkedIn
                    </Link>
                  </div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground/80">{advisor.title}</p>
                  <p>{advisor.summary}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>What we ship today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                The GuideBuoy stack covers intake, AI case notes, document automation, evidence management, router
                sessions, and Stripe-powered upgrades. Every workflow runs on Supabase auth + Postgres, with secure file
                storage and auditable logs.
              </p>
              <p>
                We release weekly from the same codebase that powers guidebuoyai.sg. Our render.com deployment uses the
                Keys you see in <code>.env</code>, ensuring total parity between staging and production.
              </p>
              <p>
                The product is purpose-built for Singaporeans navigating scams and complex complaints across multiple
                agencies, with global ambition to adapt to Malaysia and Hong Kong ODR frameworks.
              </p>
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-2xl font-semibold">Contact & HQ</h2>
            <span className="text-sm text-muted-foreground">Reach the humans behind GuideBuoy AI</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {contactChannels.map((channel) => {
              const Icon = channel.icon
              return (
                <Card key={channel.label}>
                  <CardContent className="flex flex-col gap-2 p-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2 text-foreground font-medium">
                      <Icon className="h-4 w-4" />
                      {channel.label}
                    </div>
                    <Link
                      href={channel.href}
                      target={channel.href.startsWith("http") ? "_blank" : undefined}
                      rel={channel.href.startsWith("http") ? "noreferrer" : undefined}
                      className="text-base font-semibold text-foreground hover:underline break-words"
                    >
                      {channel.value}
                    </Link>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
