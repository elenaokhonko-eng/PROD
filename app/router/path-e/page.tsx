import Link from "next/link"
import { AlertTriangle, FileText, Phone, Scale, HeartHandshake, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export const metadata = {
  title: "Crypto & Overseas Scam Guide (Path E) | GuideBuoy AI",
}

export default function PathEPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="flex items-center gap-2 w-fit">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">GB</span>
            </div>
            <span className="font-semibold text-lg">GuideBuoy AI</span>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-10">
        <div className="max-w-2xl mx-auto space-y-6">

          <div className="flex items-center gap-2">
            <Badge variant="destructive">Path E — Limited Formal Recourse</Badge>
          </div>

          {/* Honest headline */}
          <div>
            <h1 className="text-2xl font-bold text-balance mb-2">
              Formal recovery is difficult — but you have more options than you think
            </h1>
            <p className="text-muted-foreground text-base">
              Cryptocurrency exchanges and overseas platforms fall outside FIDReC&apos;s scope. We won&apos;t give you false
              hope — but there are concrete steps you can take right now, and some of them matter more than you realise.
            </p>
          </div>

          {/* Honest reality check */}
          <Card className="rounded-xl border-destructive/20 bg-destructive/5">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium text-sm">An honest assessment</p>
                  <p className="text-sm text-muted-foreground">
                    Scam syndicates move cryptocurrency and overseas funds very quickly — often within minutes — to
                    wallets or accounts outside Singapore&apos;s jurisdiction. Recovery probability drops sharply once funds
                    leave the country. We won&apos;t pretend otherwise.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    That said, every step below is worth taking — for your immediate protection, for any future legal
                    action, and for preventing others from being scammed.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step-by-step */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-lg">What to do — step by step</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {[
                {
                  step: 1,
                  title: "File a police report — do this today",
                  icon: FileText,
                  urgent: true,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        Even if recovery seems unlikely, a police report is essential for any future insurance claim,
                        legal action, or regulatory complaint.
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <a
                          href="https://eservices.police.gov.sg/content/policehubhome/homepage/police-report.html"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-primary underline text-sm"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          File online at police.gov.sg/iwitness
                        </a>
                        <span>
                          Or call ScamShield 24/7:{" "}
                          <a href="tel:1799" className="underline text-primary">
                            1799
                          </a>
                        </span>
                        <span>
                          Urgent assistance:{" "}
                          <a href="tel:999" className="underline text-primary">
                            999
                          </a>
                        </span>
                      </div>
                      <p className="font-medium text-foreground">Include in your report:</p>
                      <ul className="list-disc list-inside space-y-0.5 ml-2">
                        <li>All scammer contact details (username, wallet address, platform)</li>
                        <li>Screenshots of all conversations</li>
                        <li>Transaction records and amounts in SGD</li>
                        <li>Platform name and any account details you have for the scammer</li>
                      </ul>
                    </div>
                  ),
                },
                {
                  step: 2,
                  title: "Check the MAS Investor Alert List",
                  icon: AlertTriangle,
                  urgent: false,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        MAS maintains a list of unregulated entities that have been flagged for soliciting investments
                        without a licence. Checking if your platform is on this list strengthens your police report and
                        any future legal claim.
                      </p>
                      <a
                        href="https://www.mas.gov.sg/investor-alert-list"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-primary underline text-sm"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        MAS Investor Alert List
                      </a>
                    </div>
                  ),
                },
                {
                  step: 3,
                  title: "Get free legal advice",
                  icon: Scale,
                  urgent: false,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        A lawyer can advise you on any possible civil action — especially if you can identify the
                        scammer or their local associates.
                      </p>
                      <a
                        href="https://probono.sg"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-primary underline text-sm"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Pro Bono SG — Free Legal Clinics
                      </a>
                    </div>
                  ),
                },
                {
                  step: 4,
                  title: "Reach out for financial support if needed",
                  icon: Phone,
                  urgent: false,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        If the loss has put you under financial strain, Credit Counselling Singapore offers free,
                        confidential help.
                      </p>
                      <a
                        href="https://www.creditcounselling.org.sg"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-primary underline text-sm"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Credit Counselling Singapore (CCS)
                      </a>
                    </div>
                  ),
                },
                {
                  step: 5,
                  title: "Emotional support — you don't have to go through this alone",
                  icon: HeartHandshake,
                  urgent: false,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        Losing money to a scam is traumatic. It is common to feel shame, anger, or hopelessness — and
                        these feelings are completely understandable.
                      </p>
                      <div className="flex flex-col gap-1">
                        <span>
                          SAGE Counselling:{" "}
                          <a href="tel:18005555555" className="underline text-primary">
                            1800-555-5555
                          </a>
                        </span>
                        <span>
                          National Care Hotline:{" "}
                          <a href="tel:18002026868" className="underline text-primary">
                            1800-202-6868
                          </a>
                        </span>
                        <a
                          href="https://sage.org.sg"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-primary underline text-sm"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          SAGE Counselling Centre
                        </a>
                      </div>
                    </div>
                  ),
                },
              ].map(({ step, title, icon: Icon, urgent, content }) => (
                <div key={step} className="flex gap-4">
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      urgent ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {step}
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <p className="font-medium text-sm">
                        {title}
                        {urgent && (
                          <Badge variant="destructive" className="ml-2 text-xs py-0">
                            Do this first
                          </Badge>
                        )}
                      </p>
                    </div>
                    {content}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* If bank was involved at all */}
          <Card className="rounded-xl bg-muted/50">
            <CardContent className="pt-5">
              <p className="text-sm font-medium mb-1">Did a Singapore bank process any of the payments?</p>
              <p className="text-sm text-muted-foreground mb-3">
                If you transferred funds through a local bank account (even to a crypto platform), there may be a
                FIDReC pathway — depending on the circumstances. Let us re-assess.
              </p>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link href="/router">Re-assess my situation</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Legal disclaimer */}
          <p className="text-xs text-center text-muted-foreground">
            GuideBuoy AI is not a law firm and does not provide legal advice. This guide is for general information
            only.
          </p>

          {/* Crisis footer */}
          <div className="text-center text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
            <p className="font-medium">Crisis support</p>
            <p>
              Samaritans of Singapore (SOS):{" "}
              <a href="tel:1767" className="underline">
                1767
              </a>{" "}
              · SAGE:{" "}
              <a href="tel:18005555555" className="underline">
                1800-555-5555
              </a>{" "}
              · National Care Hotline:{" "}
              <a href="tel:18002026868" className="underline">
                1800-202-6868
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
