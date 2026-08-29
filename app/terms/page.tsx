import type { Metadata } from "next"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Terms | GuideBuoy AI",
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-3xl px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">GuideBuoy AI</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Terms</h1>
          <p className="mt-4 text-muted-foreground">Our full terms are being prepared.</p>
          <p className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">GuideBuoy helps organise information. It does not decide your case or provide legal advice.</p>
          <Button asChild variant="outline" className="mt-8">
            <Link href="/">Return home</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
