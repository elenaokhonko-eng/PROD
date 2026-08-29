import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Marketplace | GuideBuoy AI",
  description:
    "A directory of future help resources and referral options.",
}

const freeServices = [
  {
    title: "Legal-clinic resources",
    description: "Potential legal-clinic resources are planned.",
    cta: "Planned—not currently available through GuideBuoy.",
  },
  {
    title: "Social-service resources",
    description: "Potential social-service resources are planned.",
    cta: "Planned—not currently available through GuideBuoy.",
  },
  {
    title: "Warm handovers",
    description: "Potential referral options are planned.",
    cta: "Planned—not currently available through GuideBuoy.",
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
          <h1 className="text-4xl font-bold text-balance">Help resources and referral options</h1>
          <p className="text-muted-foreground max-w-3xl leading-relaxed">
            Planned—not currently available through GuideBuoy. Listed categories are not active services or referrals.
          </p>
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
              These categories will become available when the corresponding service arrangements are ready.
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
                  <Button variant="outline" className="rounded-full" disabled>{service.cta}</Button>
                  <p className="mt-2 text-xs text-muted-foreground">Planned—not currently available through GuideBuoy.</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
