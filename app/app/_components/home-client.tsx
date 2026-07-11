"use client"

import Link from "next/link"
import Image from "next/image"
import { useUser, useClerk } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default function HomeClient() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()

  const handleSignOut = async () => {
    await signOut()
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center mx-auto mb-4">
            <span className="text-primary-foreground font-bold text-sm">GB</span>
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/app" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <span className="text-sm text-muted-foreground">Welcome back!</span>
                  <Button variant="outline" size="sm" onClick={handleSignOut}>
                    Sign Out
                  </Button>
                </>
              ) : (
                <>
                  <Link href="/sign-in">
                    <Button variant="outline" size="sm">
                      Sign In
                    </Button>
                  </Link>
                  <Link href="/sign-up">
                    <Button size="sm">Get Started</Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Prototype Banner */}
      <div className="bg-accent/20 border-b border-accent/30 py-2">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-accent-foreground">You{"'"}re viewing an interactive prototype.</p>
        </div>
      </div>

      {/* Hero Section */}
      <section className="hero-gradient py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="mb-8 flex justify-center">
              <Image
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/GuideBuoy%20AI%20Lumi.jpg-aoPz1T5V8wp6KMHOH8WvFjPT811qv1.jpeg"
                alt="Lumi - Your AI Guide"
                width={120}
                height={120}
                className="rounded-full shadow-lg"
              />
            </div>

            <h1 className="text-4xl lg:text-6xl font-bold text-balance mb-6 text-foreground">
              Feeling lost after a scam or complaint? <span className="text-primary">Lumi</span> can help you chart the next step.
            </h1>

            <p className="text-xl lg:text-2xl text-muted-foreground text-pretty mb-12 max-w-3xl mx-auto leading-relaxed">
              Complex agencies can be overwhelming. I{"'"}m Lumi, your AI guide. I{"'"}ll help you build a strong, clear
              formal case in under 60 minutes.
            </p>

            <Link href="/app/case/new">
              <Button size="lg" className="text-lg px-8 py-4">
                Start Your Free Case Check
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 bg-card/30">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl lg:text-4xl font-bold text-center mb-16 text-balance">How It Works</h2>

            <div className="grid md:grid-cols-3 gap-8">
              <Card className="p-6 text-center">
                <CardContent className="p-0">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">📝</span>
                  </div>
                  <h3 className="font-semibold text-lg mb-3">Tell Your Story</h3>
                  <p className="text-muted-foreground">
                    Share what happened in simple terms. I{"'"}ll guide you through the key details.
                  </p>
                </CardContent>
              </Card>

              <Card className="p-6 text-center">
                <CardContent className="p-0">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">🔍</span>
                  </div>
                  <h3 className="font-semibold text-lg mb-3">Build Evidence</h3>
                  <p className="text-muted-foreground">
                    Upload documents and I{"'"}ll help organize them into a compelling case.
                  </p>
                </CardContent>
              </Card>

              <Card className="p-6 text-center">
                <CardContent className="p-0">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">📋</span>
                  </div>
                  <h3 className="font-semibold text-lg mb-3">Get Your Case Pack</h3>
                  <p className="text-muted-foreground">Download professional documents ready for submission.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Trust & Safety Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl lg:text-4xl font-bold mb-12 text-balance">Trust & Safety</h2>

            <div className="grid md:grid-cols-3 gap-8 mb-12">
              <div className="text-center">
                <Badge variant="secondary" className="mb-3 px-4 py-2">
                  AI Co-pilot
                </Badge>
                <p className="text-sm text-muted-foreground">
                  We{"'"}re your AI assistant, not a law firm. Professional guidance without legal advice.
                </p>
              </div>

              <div className="text-center">
                <Badge variant="secondary" className="mb-3 px-4 py-2">
                  PDPA Compliant
                </Badge>
                <p className="text-sm text-muted-foreground">
                  Your data is encrypted, secure, and handled according to Singapore privacy laws.
                </p>
              </div>

              <div className="text-center">
                <Badge variant="secondary" className="mb-3 px-4 py-2">
                  Money-Back Guarantee
                </Badge>
                <p className="text-sm text-muted-foreground">Full refund for platform faults or technical issues.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-12 bg-card/30">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </div>
            <p className="text-muted-foreground text-sm">
              Navigate cross-agency complaints with confidence. Launching December 2024.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
