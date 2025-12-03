"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, CheckCircle } from "lucide-react"
import { trackClientEvent } from "@/lib/analytics/client"

export default function WaitlistPage() {
  const searchParams = useSearchParams()
  const sourceParam = searchParams.get("source") || "waitlist_page"
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !firstName || !lastName) return

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          source: sourceParam,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to join waitlist")

      await trackClientEvent({
        eventName: "waitlist_signup",
        eventData: {
          email,
          source: sourceParam,
          timestamp: new Date().toISOString(),
        },
      })

      setIsSubmitted(true)
    } catch (error) {
      // eslint-disable-next-line no-alert
      alert("Failed to join waitlist. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-secondary">
      <header className="border-b border-border/50 bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">GB</span>
            </div>
            <span className="font-semibold text-lg">GuideBuoy AI</span>
          </Link>
          <Badge variant="secondary" className="rounded-full">
            Join the beta list
          </Badge>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <Card className="shadow-lg rounded-xl">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl text-balance">We&apos;ll notify you when your path is ready</CardTitle>
            <CardDescription>
              Enter your details and we&apos;ll email you as soon as we open this track (or match you with a specialist).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!isSubmitted ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="grid md:grid-cols-2 gap-3">
                  <Input
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                  <Input
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
                <Input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button
                  type="submit"
                  className="w-full rounded-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Joining waitlist...
                    </>
                  ) : (
                    "Join the waitlist"
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  We only use this to send updates about your case path. No spam.
                </p>
              </form>
            ) : (
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-lg">You&apos;re on the list</p>
                  <p className="text-sm text-muted-foreground">
                    We&apos;ll email you when this path goes live. You can also browse resources below.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <Button asChild className="flex-1 rounded-full">
                    <Link href="/resources">Browse self-help resources</Link>
                  </Button>
                  <Button variant="outline" asChild className="flex-1 rounded-full">
                    <Link href="/router">Start a new assessment</Link>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

