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
import { trackClientEvent } from "@/lib/analytics/client"
import { SiteHeader } from "@/components/site-header"
import { persistPendingNarrative } from "@/components/landing/hero-capture"

export default function LandingPage() {
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [narrative, setNarrative] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
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
      description: "Create an account with email, then upload your receipts, screenshots, and reference numbers. Singpass sign-in is not currently available.",
    },
    {
      stage: "Screen 3 - AI Co-Pilot",
      title: "Short Q&A to complete your report",
      description: "After your story and documents are saved, GuideBuoy organises them and asks a short Q&A to complete the record.",
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
      description: "Review the organised report and check each receiving organisation&apos;s requirements before you submit anything.",
    },
    {
      stage: "Screen 6 - Specialist Marketplace",
      title: "Escalate only when you need to",
      description: "Human consultation is not currently available. Help resources are planned—not currently available through GuideBuoy.",
    },
  ]

  const marketplaceOptions = [
    {
      title: "Help resources and referral options",
      label: "Planned",
      description: "Legal-clinic resources, social-service resources, and warm handovers are planned—not currently available through GuideBuoy.",
      cta: "Planned—not currently available through GuideBuoy.",
      variant: "outline",
    },
    {
      title: "Human consultation",
      label: "Not available",
      description: "Human consultation is not currently available.",
      cta: "Not currently available",
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
    if (isTranscribing) return

    if (!isRecording) {
      // Start recording
      try {
        setIsTranscribing(false)
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        const chunks: Blob[] = []
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data)
        }
        recorder.onstop = async () => {
          setIsTranscribing(true)
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
            setIsTranscribing(false)
            recorder.stream.getTracks().forEach((track) => track.stop())
            setMediaRecorder(null)
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
      setIsRecording(false)
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        setIsTranscribing(true)
        mediaRecorder.stop()
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
      persistPendingNarrative({ narrative })

      // Redirect to classification page
      router.push("/router/classify")

      await trackClientEvent({
        eventName: "story_submitted",
        sessionId: sessionToken,
        pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        eventData: {
          narrative_length: narrative.length,
        },
      })
    } catch (error) {
      console.error("[v0] Error submitting narrative:", error)
      alert("Something went wrong. Please try again.")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen bg-secondary">
      <SiteHeader badge="Free Helper Access" />

      {/* Hero Section */}
      <div className="py-12 md:py-20 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-balance text-foreground">
              Feeling overwhelmed by a scam or complaint? Get a clear plan, for free.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 text-pretty leading-relaxed">
              Tell Lumi what happened. GuideBuoy can organise your information into a clear record for you to review.
            </p>
            <div className="flex items-center justify-center gap-4 mb-8 flex-wrap">
              <Badge variant="outline" className="text-sm rounded-full">
                Singpass sign-in is not currently available
              </Badge>
              <Badge variant="outline" className="text-sm rounded-full">
                Automated organisation
              </Badge>
              <Badge variant="outline" className="text-sm rounded-full">
                Human consultation is not currently available
              </Badge>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/marketplace">Browse specialists</Link>
              </Button>
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
                Lumi listens in plain language, then helps organise your story into a structured report for you to review.
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
                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold text-foreground">Voice capture</p>
                    <p className="text-xs text-muted-foreground">
                      Click once to start recording and click again to stop. We will show a processing meter until your transcript is ready.
                    </p>
                  </div>
                  <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border rounded-xl bg-muted/20">
                    <button
                      onClick={handleVoiceRecording}
                      disabled={isTranscribing}
                      className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                        isRecording
                          ? "bg-destructive text-destructive-foreground animate-pulse"
                          : "bg-primary text-primary-foreground hover:scale-105"
                      } ${isTranscribing ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {isRecording ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
                    </button>
                    <p className="mt-4 text-sm font-medium">
                      {isRecording ? "Recording... Click again to stop" : "Click once to start, then click again to stop"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isTranscribing
                        ? "Processing your audio. This can take up to ~30 seconds."
                        : "Speak clearly and include all relevant details"}
                    </p>
                  </div>
                  {isTranscribing && (
                    <div className="rounded-xl border border-border bg-background/70 px-4 py-3 flex items-center gap-3">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Processing your recording</p>
                        <p className="text-xs text-muted-foreground">
                          Hang tight while we transcribe. Your text will appear below the mic button.
                        </p>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                          <div className="h-full w-1/3 bg-primary animate-pulse" />
                        </div>
                      </div>
                    </div>
                  )}
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
                . See the Privacy page for information about how data is handled.
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
                      disabled
                    >
                      {option.cta}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Privacy & Settings includes a one-click request to delete your data. The request is sent to platform administration.
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
                Review the Privacy page for current information about data handling and deletion requests
              </p>
            </Card>
            <Card className="text-center p-6 rounded-xl">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">⚡</span>
              </div>
              <h3 className="font-semibold mb-2">Instant Analysis</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Structured guidance generated from the information you provide</p>
            </Card>
            <Card className="text-center p-6 rounded-xl">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">🎯</span>
              </div>
              <h3 className="font-semibold mb-2">Expert Guidance</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Review suggested next steps and decide what to do next
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
