"use client"

import Link from "next/link"
import { Building2, ExternalLink, FileText, Landmark, LockKeyhole, MessageSquareText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"

const OFFICIAL_OPTIONS = [
  {
    title: "Protect affected accounts",
    description:
      "Use verified contact details from the relevant financial institution or platform. Do not use contact details supplied in a suspicious message.",
    icon: LockKeyhole,
  },
  {
    title: "Find the relevant Police e-service",
    description:
      "Use the Singapore Police Force website to review current online reporting services and their requirements.",
    href: "https://www.police.gov.sg/E-Services",
    source: "Singapore Police Force",
    icon: Landmark,
  },
  {
    title: "Review scam reporting guidance",
    description:
      "ScamShield publishes current information about scam checks, reporting and protective steps.",
    href: "https://www.scamshield.gov.sg/",
    source: "ScamShield",
    icon: MessageSquareText,
  },
  {
    title: "Keep a clear record",
    description:
      "Keep transaction identifiers, wallet addresses, platform details, messages and correspondence together. Keep originals unchanged where possible.",
    icon: FileText,
  },
] as const

export default function PathEPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main id="main-content" className="gb-container py-8 sm:py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <header className="text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
              <Building2 className="size-7 text-primary" aria-hidden="true" />
            </div>
            <p className="mt-5 text-sm font-semibold uppercase tracking-[0.14em] text-primary">Overseas and digital-asset incidents</p>
            <h1 className="mt-3 text-3xl font-semibold text-harbor-deep sm:text-4xl">Review official reporting options</h1>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
              Different organisations may have different roles. GuideBuoy cannot determine whether funds can be recovered or whether an organisation will accept a report.
            </p>
          </header>

          <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground" role="note">
            Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
          </p>

          <section aria-labelledby="official-options-heading">
            <h2 id="official-options-heading" className="sr-only">Official options and records</h2>
            <div className="space-y-4">
              {OFFICIAL_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <Card key={option.title}>
                    <CardHeader className="flex grid-cols-[auto_1fr] flex-row items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Icon className="size-5 text-primary" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 className="font-semibold">{option.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{option.description}</p>
                      </div>
                    </CardHeader>
                    {"href" in option && option.href && (
                      <CardContent>
                        <Button asChild variant="outline" className="w-full sm:w-auto">
                          <a href={option.href} target="_blank" rel="noopener noreferrer">
                            Open {option.source}<ExternalLink className="ml-2 size-4" aria-hidden="true" />
                          </a>
                        </Button>
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          </section>

          <Card className="bg-muted/40">
            <CardContent className="space-y-3 pt-0">
              <h2 className="font-semibold">Was a Singapore financial institution involved?</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                If a Singapore financial institution processed a payment, its complaints process or another dispute route may also be relevant. The route depends on the facts and current eligibility rules.
              </p>
              <Button asChild variant="outline"><Link href="/router">Review my answers</Link></Button>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button asChild><Link href="/resources">Browse official resources</Link></Button>
            <Button asChild variant="outline"><Link href="/router/results">Back to my result</Link></Button>
          </div>

          <p className="text-center text-xs leading-5 text-muted-foreground">
            GuideBuoy helps organise information. It does not decide your case or provide legal advice. External organisations are not affiliated with or endorsed by GuideBuoy.
          </p>
        </div>
      </main>
    </div>
  )
}
