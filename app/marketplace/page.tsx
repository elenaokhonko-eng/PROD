import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Marketplace | GuideBuoy AI",
  description:
    "Find free and paid specialists to help with your complaint: pro-bono clinics, social services, mental health support, lawyers, dispute coaches, and cybersecurity experts.",
}

const freeServices = [
  {
    title: "Pro-bono lawyers (via SAL clinics)",
    description: "Legal clinics for vulnerable users. Warm handovers when you need human guidance beyond the helper.",
    cta: "Request pro-bono support",
  },
  {
    title: "Social service partners",
    description: "Social workers who can help with reporting, recovery steps, and safeguarding vulnerable users.",
    cta: "Connect me to a social worker",
  },
  {
    title: "Mental health support",
    description: "Trauma-informed counsellors for stress and anxiety after a scam or dispute.",
    cta: "Get wellbeing support",
  },
]

const paidServices = [
  {
    title: "Lawyer case review",
    description: "Short review of your documents and likely next steps before you escalate.",
    cta: "Book a review",
  },
  {
    title: "Dispute coach / case prep",
    description: "Specialists who help structure your evidence, fill gaps, and frame arguments.",
    cta: "Work with a coach",
  },
  {
    title: "Cybersecurity specialist report",
    description: "Forensic review of links, malware, and transaction traces to strengthen your report.",
    cta: "Request a cyber report",
  },
]

export default function MarketplacePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto px-4 py-8 space-y-4">
          <Badge variant="outline" className="rounded-full">
            Marketplace
          </Badge>
          <h1 className="text-4xl font-bold text-balance">Human help only when you need it</h1>
          <p className="text-muted-foreground max-w-3xl leading-relaxed">
            The helper stays free. When you want a person to step in, pick from trusted partners below. Free options come
            first; paid specialists activate only when you choose.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-full">
              <Link href="/auth/sign-up?source=marketplace">Sign in to request help</Link>
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
              For vulnerable users or those under stress, we start with free human support before suggesting anything
              paid.
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
              When your loss is high or the case is complex, these specialists can review evidence, coach you, or prepare
              expert reports. Charges appear only when you accept.
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
                      <Link href="mailto:partners@guidebuoyai.sg">{service.cta}</Link>
                    </Button>
                    <Badge variant="outline" className="rounded-full">
                      Optional
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
