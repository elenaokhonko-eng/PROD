import type { Metadata } from "next"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Privacy | GuideBuoy AI",
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-3xl px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">GuideBuoy AI</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Privacy</h1>
          <p className="mt-4 text-muted-foreground">Our full privacy policy is being prepared.</p>
          <div className="mt-8 space-y-3 border-t border-border pt-6 text-sm text-muted-foreground">
            <p>Approved privacy and security information is being prepared.</p>
            <p>To request data deletion, sign in and use Settings. A request does not delete data immediately and may be subject to identity review and lawful retention requirements.</p>
          </div>
          <Button asChild className="mt-8">
            <Link href="/sign-in?redirect_url=/app/settings">Sign in to request deletion</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
