import Link from "next/link"
import { ExternalLink, FileText, MessageSquareText, RadioTower, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"

export const metadata = {
  title: "Telecommunications Information | GuideBuoy AI",
}

const INFORMATION_STEPS = [
  {
    title: "Keep the original message details",
    description:
      "Keep the message, sender details, date and any related transaction records. Keep originals unchanged where possible.",
    icon: MessageSquareText,
  },
  {
    title: "Use verified contact details",
    description:
      "If you contact a telecommunications provider or financial institution, use contact details from its official website rather than a suspicious message.",
    icon: RadioTower,
  },
  {
    title: "Review current IMDA information",
    description:
      "IMDA publishes current information about scam and spam prevention. Its official website explains the available channels and their scope.",
    href: "https://www.imda.gov.sg/how-we-can-help/scam-and-spam-prevention",
    source: "IMDA",
    icon: ShieldAlert,
  },
  {
    title: "Find the relevant Police e-service",
    description:
      "The Singapore Police Force website lists current online reporting services and their requirements.",
    href: "https://www.police.gov.sg/E-Services",
    source: "Singapore Police Force",
    icon: FileText,
  },
] as const

export default function PathA2Page() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main id="main-content" className="gb-container py-8 sm:py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <header className="text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
              <RadioTower className="size-7 text-primary" aria-hidden="true" />
            </div>
            <p className="mt-5 text-sm font-semibold uppercase tracking-[0.14em] text-primary">Telecommunications information</p>
            <h1 className="mt-3 text-3xl font-semibold text-harbor-deep sm:text-4xl">Review current official guidance</h1>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
              Sender details and telecommunications controls may be relevant to the incident. GuideBuoy cannot determine whether an organisation is responsible or whether a complaint will be accepted.
            </p>
          </header>

          <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground" role="note">
            Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
          </p>

          <section aria-labelledby="information-steps-heading">
            <h2 id="information-steps-heading" className="sr-only">Information to keep and official sources</h2>
            <div className="space-y-4">
              {INFORMATION_STEPS.map((step, index) => {
                const Icon = step.icon
                return (
                  <Card key={step.title}>
                    <CardHeader className="flex flex-row items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{index + 1}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <Icon className="size-4 text-primary" aria-hidden="true" />
                          <h3 className="font-semibold">{step.title}</h3>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p>
                      </div>
                    </CardHeader>
                    {"href" in step && step.href && (
                      <CardContent>
                        <Button asChild variant="outline" className="w-full sm:w-auto">
                          <a href={step.href} target="_blank" rel="noopener noreferrer">
                            Open {step.source}<ExternalLink className="ml-2 size-4" aria-hidden="true" />
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
              <h2 className="font-semibold">A financial-dispute route may also be relevant</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                If a financial institution was involved, review its complaints process and confirm current FIDReC eligibility directly with FIDReC. GuideBuoy does not decide eligibility.
              </p>
              <Button asChild variant="outline"><Link href="/onboarding">Start organising my case</Link></Button>
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
