"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Mic,
  MicOff,
  Loader2,
  ArrowRight,
  FileText,
} from "lucide-react"
import Link from "next/link"
import { createRouterSession, getSessionToken, updateRouterSession } from "@/lib/router-session"
import { marketingNavLinks } from "@/lib/navigation"

export default function LandingPage() {
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [narrative, setNarrative] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [inputMethod, setInputMethod] = useState<"voice" | "text">("text")
  const router = useRouter()

  const helperFlow = [
    {
      stage: "Screen 1 - The Helper",
      title: "Tell Lumi what happened",
      description:
        "Record or type your story. We transcribe it, classify it, and confirm it is a case GuideBuoy supports right now. If not yet supported, you’ll see a waitlist screen to sign up and get notified when your complaint type is live.",
    },
    {
      stage: "Screen 2 - Sign up and upload proof",
      title: "Save your case and add documents",
      description: "If we can help, create a free account with Singpass or email, then upload your receipts, screenshots, and reference numbers.",
    },
    {
      stage: "Screen 3 - AI Co-Pilot",
      title: "Short Q&A to complete your report",
      description: "After your story and documents are saved, Lumi reviews them, asks a short Q&A, and references publicly available Singapore guidance for context.",
    },
    {
      stage: "Screen 4 - Report Hub",
      title: "Work from your AXS Machine dashboard",
      description:
        "Edit the factual record, close evidence gaps, view next steps, and keep everything synced in one calm workspace.",
    },
    {
      stage: "Screen 5 - AXS Export & Send",
      title: "Reuse your unified report everywhere",
      description:
        "Export agency-ready PDFs now and send targeted partner packets as integrations go live. You can also request a new API integration for an agency or company with a one-click email request.",
    },
    {
      stage: "Screen 6 - Specialist Marketplace",
      title: "Escalate only when you need to",
      description:
        "If you need human help to make sense of your case, our marketplace can connect you to pro-bono lawyers, cybersecurity specialists, or case prep experts to organise your evidence and understand which statutory frameworks may apply.",
    },
  ]

  const marketplaceOptions = [
    {
      title: "Pro-bono legal and social clinics",
      label: "Public-good support",
      description: "A warm handover to SAL-linked legal clinics or social services when you need human guidance.",
      cta: "Request a referral",
      variant: "outline",
    },
    {
      title: "Specialist marketplace",
      label: "Experts when you need them",
      description:
        "Browse lawyers, cybersecurity analysts, and case-prep coaches to review evidence and map relevant frameworks with you.",
      cta: "Browse specialists",
      variant: "default",
    },
  ]

  useEffect(() => {
    // Initialize or retrieve session
    const initSession = async () => {
      const existingToken = getSessionToken()
      if (!existingToken) {
        await createRouterSession()
      }
    }
    initSession()
  }, [])

  const handleVoiceRecording = async () => {
    if (!isRecording) {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        const chunks: Blob[] = []
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data)
        }
        recorder.onstop = async () => {
          try {
            const blob = new Blob(chunks, { type: "audio/webm" })
            const form = new FormData()
            form.append("audio", blob, "recording.webm")
            const res = await fetch("/api/transcribe", { method: "POST", body: form })
            const data = await res.json()
            if (res.ok && data.transcription) {
              setNarrative(data.transcription)
            } else {
              alert(data.error || "Transcription failed")
            }
          } catch (err) {
            console.error("[v0] Transcription upload error:", err)
            alert("Failed to transcribe recording")
          } finally {
          }
        }
        recorder.start()
        setMediaRecorder(recorder)
        setIsRecording(true)
      } catch (error) {
        console.error("[v0] Error accessing microphone:", error)
        alert("Unable to access microphone. Please check your permissions.")
      }
    } else {
      // Stop recording
      try {
        mediaRecorder?.stop()
      } finally {
        setIsRecording(false)
      }
    }
  }

  const handleSubmit = async () => {
    if (!narrative.trim()) return

    setIsProcessing(true)

    try {
      const sessionToken = getSessionToken()
      if (!sessionToken) {
        throw new Error("No session token found")
      }

      // Update session with narrative
      await updateRouterSession(sessionToken, {
        dispute_narrative: narrative,
      })

      // Redirect to classification page
      router.push("/router/classify")
    } catch (error) {
      console.error("[v0] Error submitting narrative:", error)
      alert("Something went wrong. Please try again.")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen bg-secondary">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-muted-foreground">
                {marketingNavLinks.map((item) => (
                  <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
                    {item.label}
                  </Link>
                ))}
              </nav>
              <Badge variant="secondary" className="hidden sm:inline-flex rounded-full">
                Free Helper Access
              </Badge>
              <Link href="/auth/login">
                <Button variant="outline" size="sm" className="rounded-full bg-transparent">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="py-12 md:py-20 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-balance text-foreground">
              Feeling overwhelmed by a scam or complaint? Get a clear plan, for free.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 text-pretty leading-relaxed">
              We&apos;re Singapore&apos;s Complaint Helper. Tell Lumi (our lighthouse AI) what happened once and Lumi will organise
              your facts into a unified report you can reuse for the Police, national agencies, FIDReC, and more.
            </p>
            <div className="flex items-center justify-center gap-4 mb-8 flex-wrap">
              <Badge variant="outline" className="text-sm rounded-full">
                Singpass-ready & trusted
              </Badge>
              <Badge variant="outline" className="text-sm rounded-full">
                Report Once, Reuse Everywhere
              </Badge>
              <Badge variant="outline" className="text-sm rounded-full">
                Free public-good utility
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <Card className="shadow-lg rounded-xl border-border/50">
            <CardHeader>
              <CardTitle className="text-2xl">Create your unified report</CardTitle>
              <CardDescription className="leading-relaxed">
                Lumi listens in plain language, then turns your story into a structured JSON report that works for the
                Police, ScamShield, FIDReC, and ecosystem partners.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Input Method Toggle */}
              <div className="flex gap-2">
                <Button
                  variant={inputMethod === "text" ? "default" : "outline"}
                  onClick={() => setInputMethod("text")}
                  className="flex-1 rounded-full"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Type My Story
                </Button>
                <Button
                  variant={inputMethod === "voice" ? "default" : "outline"}
                  onClick={() => setInputMethod("voice")}
                  className="flex-1 rounded-full"
                >
                  <Mic className="h-4 w-4 mr-2" />
                  Record My Story (Voice-to-Report)
                </Button>
              </div>

              {/* Text Input */}
              {inputMethod === "text" && (
                <div className="space-y-4">
                  <Textarea
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    placeholder="Example: In March 2024, I sent $50,000 through a payment link that looked official. The site confirmed the transfer but the money never reached the intended account. When I contacted support, they said it was a scammer and could not help."
                    rows={10}
                    className="resize-none text-base rounded-xl"
                  />
                  <p className="text-sm text-muted-foreground">
                    {narrative.length} characters • Aim for at least 100 characters for best results
                  </p>
                </div>
              )}

              {/* Voice Input */}
              {inputMethod === "voice" && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border rounded-xl bg-muted/20">
                    <button
                      onClick={handleVoiceRecording}
                      className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                        isRecording
                          ? "bg-destructive text-destructive-foreground animate-pulse"
                          : "bg-primary text-primary-foreground hover:scale-105"
                      }`}
                    >
                      {isRecording ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
                    </button>
                    <p className="mt-4 text-sm font-medium">
                      {isRecording ? "Recording... Click to stop" : "Click to start recording"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Speak clearly and include all relevant details</p>
                  </div>
                  {narrative && (
                    <div className="p-4 bg-muted/50 rounded-xl">
                      <p className="text-sm font-medium mb-2">Transcript:</p>
                      <p className="text-sm leading-relaxed">{narrative}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Example Prompts */}
              {/* Example Prompts */}
              <div className="bg-primary/5 p-4 rounded-xl border border-primary/10">
                <p className="text-sm font-medium mb-2 text-foreground">What to include:</p>
                <ul className="text-sm space-y-1 text-muted-foreground leading-relaxed">
                  <li>- Product or channel involved (account, card, plan, portal, etc.)</li>
                  <li>- Timeline with approximate dates and amounts lost</li>
                  <li>- Scammer or institution names, phone numbers, or links</li>
                  <li>- What you already told any hotline or agency</li>
                  <li>- Any reference numbers or evidence you already have</li>
                </ul>
              </div>

              {/* Submit Button */}
              <Button
                onClick={handleSubmit}
                disabled={!narrative.trim() || isProcessing}
                size="lg"
                className="w-full rounded-full"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing Your Case...
                  </>
                ) : (
                  <>
                    Start Organizing (Free)
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground leading-relaxed">
                By continuing, you agree to our{" "}
                <Link href="/privacy" className="underline hover:text-foreground">
                  Privacy Policy
                </Link>
                . Your data is encrypted and anonymized for AI training.
              </p>
            </CardContent>
          </Card>

          {/* Unified Flow Overview */}
          <section className="mt-16 space-y-8">
            <div className="text-center space-y-3">
              <Badge variant="secondary" className="mx-auto w-fit">
                Unified Helper Flow
              </Badge>
              <h2 className="text-3xl font-semibold">How Lumi guides every user</h2>
              <p className="text-muted-foreground">
                Start with a voice-to-text story, sign up to upload proof, then Lumi reviews your story and documents, runs a short Q&A, and only then references publicly available Singapore guidance for context before you manage everything in the AXS-style hub.
              </p>
            </div>
            <div className="grid gap-4">
              {helperFlow.map((stage) => (
                <Card key={stage.title} className="bg-card/60 border-border/60">
                  <CardContent className="py-5">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{stage.stage}</p>
                    <h3 className="text-lg font-semibold text-foreground mt-1">{stage.title}</h3>
                    <p className="text-sm text-muted-foreground mt-2">{stage.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Marketplace */}
          <section className="mt-16 space-y-6">
            <div className="text-center space-y-3">
              <Badge variant="secondary" className="mx-auto w-fit">
                Module 5 · Marketplace
              </Badge>
              <h2 className="text-3xl font-semibold">Need more help?</h2>
              <p className="text-muted-foreground">
                Keep the helper free, and tap the marketplace only if you want a human to step in. Specialists are
                optional and activate only when you choose.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {marketplaceOptions.map((option) => (
                <Card key={option.title} className="border-border/70 h-full">
                  <CardContent className="py-6 space-y-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{option.label}</p>
                    <h3 className="text-xl font-semibold text-foreground">{option.title}</h3>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                    <Button
                      variant={option.variant === "outline" ? "outline" : "default"}
                      className="rounded-full w-fit"
                    >
                      {option.cta}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Module 6 · Privacy & Settings: includes a one-click &ldquo;Delete my report&rdquo; button so every pilot
              meets Trusted AI benchmarks.
            </p>
          </section>

          {/* Trust Indicators */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="text-center p-6 rounded-xl">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">🔒</span>
              </div>
              <h3 className="font-semibold mb-2">Secure & Private</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your information is encrypted and never shared without permission
              </p>
            </Card>
            <Card className="text-center p-6 rounded-xl">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">⚡</span>
              </div>
              <h3 className="font-semibold mb-2">Instant Analysis</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">AI-powered assessment in under 2 minutes</p>
            </Card>
            <Card className="text-center p-6 rounded-xl">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">🎯</span>
              </div>
              <h3 className="font-semibold mb-2">Expert Guidance</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Get personalized next steps based on your situation
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
