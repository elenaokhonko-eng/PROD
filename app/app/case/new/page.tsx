import { redirect } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"

export default async function NewCasePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto">
          <Card className="rounded-xl shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Create New Case for a Client</CardTitle>
              <CardDescription>
                Start a free triage to assess eligibility. You can invite your client to take over ownership later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                We’ll guide you through a few questions to classify the report and recommend next steps.
              </p>
              <Link href="/router">
                <Button variant="default" size="lg" className="rounded-full w-full">Start Free Triage</Button>
              </Link>
              <p className="text-xs text-muted-foreground text-center">
                After triage, use “Invite a Helper/Client” from the dashboard to share and transfer case ownership.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
