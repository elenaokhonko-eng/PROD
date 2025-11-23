import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Volunteer Marketplace | GuideBuoy AI",
  description:
    "Join as a nominee or volunteer to help victims organise evidence, file reports, and recover funds from banks, card companies, or merchants.",
}

const roles = [
  {
    title: "Nominee support",
    description: "Act as a trusted nominee for users who need help talking to banks, card companies, or merchants.",
  },
  {
    title: "Evidence organiser",
    description: "Help users structure timelines, label documents, and close checklist gaps inside the Report Hub.",
  },
  {
    title: "Guided follow-up",
    description: "Coach users on calm next steps, status updates, and follow-up emails to agencies or providers.",
  },
]

const expectations = [
  "Be responsive and transparent about availability.",
  "Follow our privacy and consent rules before handling any documents.",
  "Keep a calm, non-adversarial tone; escalate only when needed.",
]

export default function VolunteersPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border/50 bg-card/50">
        <div className="container mx-auto px-4 py-8 space-y-4">
          <Badge variant="outline" className="rounded-full">
            Volunteer marketplace
          </Badge>
          <h1 className="text-4xl font-bold text-balance">Help citizens as a nominee or volunteer</h1>
          <p className="text-muted-foreground max-w-3xl leading-relaxed">
            Join the GuideBuoy network to support victims with filing, evidence prep, and follow-ups. Volunteers stay
            free; we only match you to cases that fit your experience and availability.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-full">
              <Link href="mailto:partners@guidebuoyai.sg?subject=Volunteer%20nominee%20application">Apply to volunteer</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/auth/sign-up?source=volunteers">Sign in to view open cases</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 space-y-10">
        <section className="space-y-4">
          <div className="space-y-2">
            <Badge variant="secondary" className="rounded-full">
              What you can do
            </Badge>
            <h2 className="text-2xl font-semibold">Roles for volunteers</h2>
            <p className="text-muted-foreground max-w-2xl">
              Pick the ways you want to help. We keep the matching lightweight so you can focus on people, not admin.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roles.map((role) => (
              <Card key={role.title} className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">{role.title}</CardTitle>
                  <CardDescription>{role.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant="outline" className="rounded-full">
                    Community
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-2">
            <Badge variant="secondary" className="rounded-full">
              How we work together
            </Badge>
            <h2 className="text-2xl font-semibold">Expectations</h2>
            <p className="text-muted-foreground max-w-2xl">
              Volunteers follow the same calm, trusted AI principles as the helper. Privacy and consent come first.
            </p>
          </div>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                {expectations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}
