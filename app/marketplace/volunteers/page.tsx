import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Volunteer opportunities | GuideBuoy AI",
  description: "Volunteer opportunities are planned and not currently available through GuideBuoy.",
}

export default function VolunteersPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-3xl px-4 py-16">
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="space-y-5 p-6 sm:p-10">
            <Badge variant="outline" className="w-fit rounded-full">Volunteer opportunities</Badge>
            <h1 className="text-3xl font-semibold tracking-tight">Volunteer opportunities</h1>
            <p className="max-w-2xl text-muted-foreground">Planned—not currently available through GuideBuoy. There are no active volunteer roles, case matching, or applications.</p>
            <Button variant="outline" disabled>Planned—not currently available through GuideBuoy.</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
