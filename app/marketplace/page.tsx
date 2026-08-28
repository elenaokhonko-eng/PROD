import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Marketplace | GuideBuoy AI",
  description:
    "Find free and paid specialists to help with your complaint: pro-bono clinics, social services, mental health support, lawyers, dispute coaches, and cybersecurity experts.",
}

const freeServices = [
  {
    title: "Pro-bono lawyers (via SAL clinics)",
    description: "Legal clinics for vulnerable users. Warm handovers when you need human guidance beyond the helper.",
    cta: "Ask about availability",
  },
  {
    title: "Social service partners",
    description: "Social workers who can help with reporting, recovery steps, and safeguarding vulnerable users.",
    cta: "Ask about availability",
  },
  {
    title: "Mental health support",
    description: "Trauma-informed counsellors for stress and anxiety after a scam or dispute.",
    cta: "Ask about availability",
  },
]

const paidServices = [
  {
    title: "Lawyer case review",
    description: "Short review of your documents and likely next steps before you escalate.",
    cta: "Join the availability list",
  },
  {
    title: "Dispute coach / case prep",
    description: "Specialists who help structure your evidence, fill gaps, and frame arguments.",
    cta: "Join the availability list",
    email: "info@guidebuoyai.sg",
  },
  {
    title: "Cybersecurity specialist report",
    description: "Forensic review of links, malware, and transaction traces to strengthen your report.",
    cta: "Join the availability list",
  },
]

export default function MarketplacePage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto px-4 py-8 space-y-4">
          <Badge variant="outline" className="rounded-full">
            Marketplace
          </Badge>
          <h1 className="text-4xl font-bold text-balance">Human help only when you need it</h1>
          <p className="text-muted-foreground max-w-3xl leading-relaxed">
            Start with the free User Pack. Human-support options are introduced only when a verified pathway is
            available; paid specialists remain closed until fulfilment and availability checks pass.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-full">
              <Link href="/sign-up?source=marketplace">Sign in to request help</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="mailto:partners@guidebuoyai.sg">Partner with us</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 space-y-12">
        <section className="space-y-6">
          <div className="space-y-2">
            <Badge variant="secondary" className="rounded-full">
              Free help
            </Badge>
            <h2 className="text-2xl font-semibold">Public-good support</h2>
            <p className="text-muted-foreground max-w-2xl">
              These are support categories GuideBuoy is working to make available. Eligibility and partner capacity vary,
              so submitting an enquiry does not guarantee a referral.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {freeServices.map((service) => (
              <Card key={service.title} className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">{service.title}</CardTitle>
                  <CardDescription>{service.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link href="mailto:partners@guidebuoyai.sg">{service.cta}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="space-y-2">
            <Badge variant="secondary" className="rounded-full">
              Paid assistance
            </Badge>
            <h2 className="text-2xl font-semibold">Specialists for deeper help</h2>
            <p className="text-muted-foreground max-w-2xl">
              These planned specialist services will open only after fulfilment is verified. Joining the availability list
              is not a booking and does not create a charge.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {paidServices.map((service) => (
              <Card key={service.title} className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">{service.title}</CardTitle>
                  <CardDescription>{service.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Button asChild className="rounded-full">
                      <Link href={`mailto:${service.email ?? "partners@guidebuoyai.sg"}`}>{service.cta}</Link>
                    </Button>
                    <Badge variant="outline" className="rounded-full">
                      Availability gated
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
