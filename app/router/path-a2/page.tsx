import Link from "next/link"
import { ArrowRight, AlertTriangle, MessageSquare, Phone, FileText, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export const metadata = {
  title: "Telco Complaint Guide (SRF Path A2) | GuideBuoy AI",
}

const TELCO_CONTACTS = [
  { name: "Singtel", hotline: "1688", website: "singtel.com/contactus" },
  { name: "StarHub", hotline: "1633", website: "starhub.com/contactus" },
  { name: "M1", hotline: "1627", website: "m1.com.sg/contactus" },
  { name: "TPG Telecom", hotline: "6011 8888", website: "tpgtelecom.com.sg" },
  { name: "Grid Communications", hotline: "6278 1788", website: "grid.com.sg" },
]

export default function PathA2Page() {
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

          {/* Path context badge */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">SRF — Telco Liability (Path A2)</Badge>
          </div>

          {/* Hero */}
          <div>
            <h1 className="text-2xl font-bold text-balance mb-2">
              The telco may be responsible for this scam
            </h1>
            <p className="text-muted-foreground text-base">
              Under Singapore&apos;s Shared Responsibility Framework (SRF), telcos must block fraudulent SMS sender IDs
              and implement anti-scam filters. If your bank met all its obligations but the telco did not, the telco
              bears liability — and you can file a complaint with IMDA.
            </p>
          </div>

          {/* What happened */}
          <Card className="rounded-xl border-primary/20 bg-primary/5">
            <CardContent className="pt-5 space-y-2">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Why you&apos;re on this path</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your triage suggests your bank likely complied with its SRF duties. Under the SRF waterfall, when
                    the bank meets its obligations but the telco failed to block a spoofed SMS sender ID, liability
                    shifts to the telco.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step-by-step guide */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-lg">What to do — step by step</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {[
                {
                  step: 1,
                  title: "File a police report first",
                  icon: FileText,
                  content: (
                    <p className="text-sm text-muted-foreground">
                      File at{" "}
                      <a
                        href="https://eservices.police.gov.sg/content/policehubhome/homepage/police-report.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-primary"
                      >
                        police.gov.sg/iwitness
                      </a>{" "}
                      or call ScamShield:{" "}
                      <a href="tel:1799" className="underline text-primary">
                        1799
                      </a>
                      . Keep the police report reference number — IMDA will ask for it.
                    </p>
                  ),
                },
                {
                  step: 2,
                  title: "Preserve all SMS evidence",
                  icon: MessageSquare,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Before contacting IMDA, screenshot and back up:</p>
                      <ul className="list-disc list-inside space-y-0.5 ml-2">
                        <li>The fraudulent SMS messages (showing the spoofed sender name)</li>
                        <li>Your legitimate messages from the same sender name (to show the spoofing)</li>
                        <li>Bank transaction records</li>
                        <li>Your bank&apos;s correspondence confirming it met its SRF duties</li>
                      </ul>
                    </div>
                  ),
                },
                {
                  step: 3,
                  title: "Contact your telco directly first",
                  icon: Phone,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-3">
                      <p>
                        Before involving IMDA, raise the issue with your telco. Keep a record of all communications
                        (date, channel, what was said).
                      </p>
                      <div className="grid gap-2">
                        {TELCO_CONTACTS.map((t) => (
                          <div
                            key={t.name}
                            className="flex items-center justify-between text-xs border border-border rounded-lg px-3 py-2"
                          >
                            <span className="font-medium">{t.name}</span>
                            <span className="text-muted-foreground">
                              <a href={`tel:${t.hotline.replace(/\s/g, "")}`} className="underline">
                                {t.hotline}
                              </a>{" "}
                              ·{" "}
                              <a
                                href={`https://${t.website}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                {t.website}
                              </a>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                },
                {
                  step: 4,
                  title: "File a complaint with IMDA",
                  icon: AlertTriangle,
                  content: (
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        If the telco does not resolve your complaint satisfactorily, file formally with IMDA — the
                        regulator for telcos in Singapore.
                      </p>
                      <p>
                        File at:{" "}
                        <a
                          href="https://www.imda.gov.sg/complaints"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-primary"
                        >
                          imda.gov.sg/complaints
                        </a>
                      </p>
                      <p>Include in your complaint:</p>
                      <ul className="list-disc list-inside space-y-0.5 ml-2">
                        <li>Police report reference number</li>
                        <li>Screenshots of the fraudulent SMS with spoofed sender ID</li>
                        <li>Your telco&apos;s response (or lack of response)</li>
                        <li>Approximate date and amount lost</li>
                        <li>Your bank&apos;s confirmation that it complied with SRF duties</li>
                      </ul>
                    </div>
                  ),
                },
              ].map(({ step, title, icon: Icon, content }) => (
                <div key={step} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                    {step}
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <p className="font-medium text-sm">{title}</p>
                    </div>
                    {content}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* FIDReC parallel path */}
          <Card className="rounded-xl bg-muted/50">
            <CardContent className="pt-5">
              <p className="text-sm font-medium mb-1">Can I still go to FIDReC?</p>
              <p className="text-sm text-muted-foreground">
                Yes. If you believe your bank also played a role, you can pursue FIDReC at the same time as your IMDA
                complaint. The two paths are not mutually exclusive. FIDReC filing is free.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3 rounded-full">
                <Link href="/auth/sign-up?source=path-a2&parallel=fidrec">
                  Also build a FIDReC case
                  <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Legal disclaimer */}
          <p className="text-xs text-center text-muted-foreground">
            GuideBuoy AI is not a law firm and does not provide legal advice. This guide is for general information
            only. For professional advice, visit{" "}
            <a href="https://probono.sg" target="_blank" rel="noopener noreferrer" className="underline">
              Pro Bono SG
            </a>
            .
          </p>

          {/* Crisis footer */}
          <div className="text-center text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
            <p className="font-medium">Need immediate support?</p>
            <p>
              Samaritans (SOS):{" "}
              <a href="tel:1767" className="underline">
                1767
              </a>{" "}
              · SAGE Counselling:{" "}
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
