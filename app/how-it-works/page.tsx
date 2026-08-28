import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, CheckCircle2, FileSearch, MessageSquareText, ShieldCheck } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "How GuideBuoy Works | Tell It Once",
  description: "See how GuideBuoy turns your story and evidence into clear complaint packs and next steps.",
}

const steps = [
  { icon: MessageSquareText, title: "Tell your story once", body: "Type or speak in your own words. You can pause, return, and change details later." },
  { icon: FileSearch, title: "Add the evidence you have", body: "Upload statements, screenshots, receipts, and correspondence. Lumi organises what is ready and explains gaps plainly." },
  { icon: CheckCircle2, title: "Review your User Pack", body: "Get a free organised draft, evidence checklist, and a preliminary pathway signal before choosing any paid help." },
  { icon: ShieldCheck, title: "Choose your next step", body: "Create an FI Pack for your financial institution, or prepare a FIDReC Pack when escalation is appropriate." },
]

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">A calmer complaint process</p>
          <h1 className="mt-4 text-balance text-4xl font-semibold leading-tight text-foreground md:text-6xl">Explain it once. Organise it clearly. Know what to do next.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">GuideBuoy helps people in Singapore carry one clear factual record from first response through financial-institution and FIDReC pathways.</p>
        </div>
        <ol className="mt-14 grid gap-5 md:grid-cols-2">
          {steps.map((step, index) => {
            const Icon = step.icon
            return (
              <li key={step.title}>
                <Card className="h-full border-border bg-card shadow-ambient">
                  <CardContent className="p-7">
                    <div className="flex items-center gap-3"><span className="gb-num text-sm font-semibold text-muted-foreground">0{index + 1}</span><Icon aria-hidden="true" className="h-6 w-6 text-primary" /></div>
                    <h2 className="mt-6 text-xl font-semibold">{step.title}</h2>
                    <p className="mt-3 leading-relaxed text-muted-foreground">{step.body}</p>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ol>
        <div className="mt-14 rounded-[14px] bg-[var(--gb-tint-lavender)] p-8 md:flex md:items-center md:justify-between md:gap-8">
          <div><h2 className="text-2xl font-semibold">Start with the free User Pack</h2><p className="mt-2 text-muted-foreground">No outcome guarantee and no legal advice—just a clearer record and next step.</p></div>
          <Button asChild className="mt-6 min-h-12 md:mt-0"><Link href="/">Tell Lumi what happened <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></Link></Button>
        </div>
      </section>
    </main>
  )
}
