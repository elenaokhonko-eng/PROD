"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowRight, Clock, CheckCircle, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const TIPS_WHILE_WAITING = [
  {
    title: "Gather all bank correspondence",
    body: "Locate every email, SMS, and letter from your bank about this incident. Note the date, channel, and content of each communication.",
  },
  {
    title: "Screenshot everything",
    body: "Screenshots of fraudulent messages, fake websites, or suspicious transactions are crucial evidence. Back them up to cloud storage today.",
  },
  {
    title: "Write a timeline",
    body: "Write down every key event in order: when you were contacted, when you clicked or transferred, when you noticed something was wrong, when you contacted the bank.",
  },
  {
    title: "Do not engage further with the scammer",
    body: "Block all contact. Do not send any additional funds, even if promised a refund or threatened with legal action.",
  },
  {
    title: "Avoid making admissions to your bank",
    body: "When speaking with your bank, stick to facts. Avoid phrases like 'I should have known' or 'it was my fault'. These may weaken your FIDReC position.",
  },
]

export default function TrackerPage() {
  const searchParams = useSearchParams()
  const [bankContactDate, setBankContactDate] = useState(
    searchParams.get("date") ?? "",
  )
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const [daysElapsed, setDaysElapsed] = useState<number | null>(null)

  useEffect(() => {
    if (!bankContactDate) {
      setDaysElapsed(null)
      return
    }
    const diff = Math.floor(
      (Date.now() - new Date(bankContactDate).getTime()) / 86_400_000,
    )
    setDaysElapsed(diff)
  }, [bankContactDate])

  const daysLeft = daysElapsed !== null ? Math.max(0, 28 - daysElapsed) : null
  const pct = daysElapsed !== null ? Math.min(100, Math.round((daysElapsed / 28) * 100)) : 0
  const ready = daysElapsed !== null && daysElapsed >= 28

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
        <div className="max-w-xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">4-Week Bank Dispute Tracker</h1>
            <p className="text-muted-foreground text-base">
              FIDReC requires you to give your bank at least 4 weeks to respond before you can escalate.
              Track the deadline and use the time to build your evidence.
            </p>
          </div>

          {/* Date input */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                When did you first contact your bank?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="bankDate">Date of first bank contact</Label>
                <Input
                  id="bankDate"
                  type="date"
                  value={bankContactDate}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setBankContactDate(e.target.value)}
                />
              </div>

              {/* Countdown */}
              {daysElapsed !== null && (
                <div className="pt-2 space-y-3">
                  <div className="flex justify-between text-sm font-medium">
                    <span>Day {daysElapsed} of 28</span>
                    <span
                      className={ready ? "text-accent" : "text-primary"}
                    >
                      {ready ? "Ready to file with FIDReC" : `${daysLeft} days remaining`}
                    </span>
                  </div>
                  <Progress value={pct} className="h-3" />

                  {ready ? (
                    <div className="flex items-start gap-3 bg-accent/10 border border-accent/30 p-4 rounded-xl">
                      <CheckCircle className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">You can now escalate to FIDReC</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          It has been {daysElapsed} days since your bank was contacted. Sign up to build your
                          FIDReC submission.
                        </p>
                        <Button asChild size="sm" className="mt-3 rounded-full">
                          <Link href="/onboarding">
                            Build my FIDReC case
                            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 bg-primary/5 border border-primary/20 p-4 rounded-xl">
                      <AlertTriangle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">
                          Hold tight — {daysLeft} more day{daysLeft !== 1 ? "s" : ""} to go
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Use this time to gather evidence. We&apos;ll help you build a strong case when the wait
                          period ends.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email reminder */}
          {!ready && daysElapsed !== null && !submitted && (
            <Card className="rounded-xl">
              <CardContent className="pt-5 space-y-3">
                <p className="font-medium text-sm">Get a reminder when you can file</p>
                <p className="text-xs text-muted-foreground">
                  Enter your email and we&apos;ll notify you on day 28. No account required. We won&apos;t share your
                  email.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    className="rounded-full"
                    disabled={!email.includes("@")}
                    onClick={() => {
                      // TODO: wire up to reminder email API
                      setSubmitted(true)
                    }}
                  >
                    Remind me
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {submitted && (
            <div className="flex items-center gap-2 text-sm text-accent bg-accent/10 border border-accent/30 px-4 py-3 rounded-xl">
              <CheckCircle className="h-4 w-4 flex-shrink-0" />
              Got it — we&apos;ll email you when you&apos;re ready to file with FIDReC.
            </div>
          )}

          {/* Tips while waiting */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">What to do while you wait</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {TIPS_WHILE_WAITING.map((tip, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">
                    {i + 1}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{tip.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{tip.body}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Crisis footer */}
          <div className="text-center text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
            <p className="font-medium">Need immediate support?</p>
            <p>
              Samaritans (SOS):{" "}
              <a href="tel:1767" className="underline">1767</a>{" "}
              · SAGE:{" "}
              <a href="tel:18005555555" className="underline">1800-555-5555</a>{" "}
              · National Care Hotline:{" "}
              <a href="tel:18002026868" className="underline">1800-202-6868</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
