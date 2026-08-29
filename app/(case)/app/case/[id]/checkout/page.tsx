"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowRight, CheckCircle, Loader2, ShieldCheck, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ---------------------------------------------------------------------------
// Pricing tiers — mirrors PRD §9
// ---------------------------------------------------------------------------

type PricingTier = "standard" | "srf" | "complex"

interface TierPricing {
  label: string
  criteria: string
  report: number
  builder: number
  bundle: number
  bundleSaving: number
}

const TIERS: Record<PricingTier, TierPricing> = {
  standard: {
    label: "Standard",
    criteria: "Single FI, clear fact pattern",
    report: 49,
    builder: 99,
    bundle: 129,
    bundleSaving: 19,
  },
  srf: {
    label: "SRF / Multi-FI",
    criteria: "SRF analysis required or multiple FIs involved",
    report: 79,
    builder: 129,
    bundle: 179,
    bundleSaving: 29,
  },
  complex: {
    label: "Complex",
    criteria: "High-value (>S$50K), multi-party, or mixed SRF/non-SRF",
    report: 99,
    builder: 149,
    bundle: 219,
    bundleSaving: 29,
  },
}

type ProductType = "report" | "bundle"

interface CaseSummary {
  id: string
  claim_amount?: number | null
  eligibility_status?: string | null
  institution_name?: string | null
}

function determineTier(c: CaseSummary | null): PricingTier {
  if (!c) return "standard"
  if (c.claim_amount && c.claim_amount > 50_000) return "complex"
  if (c.eligibility_status === "srf_eligible") return "srf"
  return "standard"
}

export default function CheckoutPage() {
  const params = useParams<{ id: string }>()
  const caseId = params.id
  const router = useRouter()

  const [caseData, setCaseData] = useState<CaseSummary | null>(null)
  const [selected, setSelected] = useState<ProductType>("bundle")
  const [isLoading, setIsLoading] = useState(true)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/cases/${caseId}/details`)
        if (res.ok) {
          const json = await res.json()
          setCaseData((json.case ?? json) as CaseSummary)
        }
      } catch {
        // Non-fatal — proceed with default tier
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [caseId])

  const tier = determineTier(caseData)
  const pricing = TIERS[tier]
  const price = selected === "bundle" ? pricing.bundle : pricing.report
  const displayLabel = selected === "bundle" ? "Report + Case Builder Bundle" : "Case Readiness Report"

  const handlePay = async () => {
    setIsRedirecting(true)
    setError(null)
    try {
      const res = await fetch("/api/payments/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, productType: selected, tier }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        router.push(data.url as string)
      } else {
        setError(data.error ?? "Failed to start checkout. Please try again.")
        setIsRedirecting(false)
      }
    } catch {
      setError("Something went wrong. Please try again.")
      setIsRedirecting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <Link href={`/app/case/${caseId}/dashboard`} className="flex items-center gap-2 w-fit text-sm text-muted-foreground hover:text-foreground">
            ← Back to case
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-10">
        <div className="max-w-xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">Choose your plan</h1>
            <p className="text-muted-foreground">
              All plans help you build a stronger case. The bundle gives you everything at a saving.
            </p>
          </div>

          {/* Tier badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Your tier:</span>
            <Badge variant="secondary">{pricing.label}</Badge>
            <span className="text-xs text-muted-foreground">— {pricing.criteria}</span>
          </div>

          {/* Product selector */}
          <div className="space-y-3">
            {/* Report only */}
            <button
              onClick={() => setSelected("report")}
              className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                selected === "report"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">Case Readiness Report</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Evidence inventory · Evidence gaps · Bank duty checklist · Strength indicator · Risk flags
                  </p>
                </div>
                <span className="font-bold text-lg ml-4 flex-shrink-0">S${pricing.report}</span>
              </div>
            </button>

            {/* Bundle */}
            <button
              onClick={() => setSelected("bundle")}
              className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                selected === "bundle"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">Report + Case Builder Bundle</p>
                    <Badge className="text-xs bg-accent text-accent-foreground">
                      Save S${pricing.bundleSaving}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Everything in the Report, plus: Timeline builder · FIDReC statement drafter · Evidence labelling ·
                    Bank correspondence log
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 line-through">
                    S${pricing.report + pricing.builder} separately
                  </p>
                </div>
                <span className="font-bold text-lg ml-4 flex-shrink-0">S${pricing.bundle}</span>
              </div>
            </button>
          </div>

          {/* Order summary */}
          <Card className="rounded-xl bg-muted/40">
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>{displayLabel}</span>
                <span className="font-medium">S${price}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-border/50 pt-2">
                <span>Total (SGD)</span>
                <span>S${price}</span>
              </div>
            </CardContent>
          </Card>

          {/* Pay button */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-xl">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <Button
            size="lg"
            className="w-full rounded-full"
            disabled={isRedirecting}
            onClick={() => void handlePay()}
          >
            {isRedirecting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Redirecting to payment...
              </>
            ) : (
              <>
                Pay S${price} securely
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Payments processed securely by Stripe. We do not store your card details.
          </p>

          {/* Refund policy — PRD §9 requires this to be visible before payment */}
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Refund policy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {[
                {
                  icon: CheckCircle,
                  text: "Full refund within 24 hours if you have not viewed the Case Readiness Report.",
                },
                {
                  icon: CheckCircle,
                  text: "50% refund within 48 hours if you have viewed the report but not started the Case Builder.",
                },
                {
                  icon: CheckCircle,
                  text: "No refund after Case Builder work has begun — you have received and can act on the deliverables.",
                },
                {
                  icon: CheckCircle,
                  text: "If our triage was materially incorrect (e.g. we said SRF-eligible when it clearly wasn't), full refund regardless of timing.",
                },
                {
                  icon: CheckCircle,
                  text: "All refund requests handled within 3 business days.",
                },
              ].map(({ icon: Icon, text }, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Icon className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
                  <span>{text}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Legal disclaimer */}
          <p className="text-xs text-center text-muted-foreground">
            GuideBuoy AI is not a law firm and does not provide legal advice. Our reports are for guidance only. For
            legal advice, contact{" "}
            <a href="https://probono.sg" target="_blank" rel="noopener noreferrer" className="underline">
              Pro Bono SG
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
