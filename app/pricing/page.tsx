import type { Metadata } from "next"
import Link from "next/link"
import { Check } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = { title: "GuideBuoy Packs and Pricing", description: "Compare the free User Pack, SGD 18 FI Pack, SGD 188 FIDReC Pack, and optional specialist consultation." }

const packs = [
  { name: "User Pack", price: "Free", description: "Organise your story, evidence, missing details, and likely pathway.", features: ["Story and evidence workspace", "Focused gap questions", "Free organised draft"], cta: "Start free", href: "/" },
  { name: "FI Pack", price: "SGD 18", description: "A structured complaint pack for your financial institution.", features: ["Chronology and disputed transactions", "Evidence map", "Requested resolution and report export"], cta: "Start with your User Pack", href: "/" },
  { name: "FIDReC Pack", price: "SGD 188", description: "Case-linked preparation for a Financial Industry Disputes Resolution Centre submission.", features: ["Executive summary", "Chronology and timeline", "PDF and Markdown downloads"], cta: "See how escalation works", href: "/how-it-works" },
]

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-3xl text-center"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Clear choices, no pressure</p><h1 className="mt-4 text-balance text-4xl font-semibold md:text-6xl">Start free. Pay only when you choose more help.</h1><p className="mt-6 text-lg leading-relaxed text-muted-foreground">Your facts and evidence stay with the same case as you move between packs.</p></div>
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {packs.map((pack) => (
            <Card key={pack.name} className="flex h-full flex-col border-border bg-card shadow-ambient">
              <CardHeader className="p-7 pb-4"><CardTitle className="text-2xl">{pack.name}</CardTitle><p className="gb-num mt-3 text-3xl font-semibold text-primary">{pack.price}</p><p className="mt-3 leading-relaxed text-muted-foreground">{pack.description}</p></CardHeader>
              <CardContent className="flex flex-1 flex-col p-7 pt-2"><ul className="space-y-3">{pack.features.map((feature) => <li key={feature} className="flex gap-3 text-sm leading-relaxed"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--gb-success)]" /><span>{feature}</span></li>)}</ul><Button asChild variant={pack.name === "FI Pack" ? "default" : "outline"} className="mt-8 min-h-12 w-full"><Link href={pack.href}>{pack.cta}</Link></Button></CardContent>
            </Card>
          ))}
        </div>
        <aside className="mt-8 rounded-[14px] border border-border bg-[var(--gb-tint-sand)] p-6 text-sm leading-relaxed text-muted-foreground">Optional 30-minute human consultation: <span className="gb-num font-semibold text-foreground">SGD 99</span>. Availability and fulfilment terms are confirmed before purchase. GuideBuoy does not provide legal advice or guarantee outcomes.</aside>
      </section>
    </main>
  )
}
