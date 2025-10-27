"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Mic, MicOff, Loader2, ArrowRight, FileText } from "lucide-react"
import Link from "next/link"
import { createRouterSession, getSessionToken, updateRouterSession } from "@/lib/router-session"

export default function RouterPage() {
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [narrative, setNarrative] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [inputMethod, setInputMethod] = useState<"voice" | "text">("text")
  const router = useRouter()

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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="hidden sm:inline-flex">
                Free Dispute Check
              </Badge>
              <Link href="/auth/login">
                <Button variant="outline" size="sm">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="hero-gradient py-12 md:py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-balance">
              Tell us what happened with your bank or insurer
            </h1>
            <p className="text-lg text-muted-foreground mb-8 text-pretty">
              Share your story in your own words. Our AI will help determine if you have a case and guide you through
              the next steps.
            </p>
            <div className="flex items-center justify-center gap-4 mb-8">
              <Badge variant="outline" className="text-sm">
                100% Confidential
              </Badge>
              <Badge variant="outline" className="text-sm">
                No Sign-Up Required
              </Badge>
              <Badge variant="outline" className="text-sm">
                Takes 2 Minutes
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl">Share Your Dispute</CardTitle>
              <CardDescription>
                Describe what happened in your own words. Include details like dates, amounts, and what the institution
                did or did not do.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Input Method Toggle */}
              <div className="flex gap-2">
                <Button
                  variant={inputMethod === "text" ? "default" : "outline"}
                  onClick={() => setInputMethod("text")}
                  className="flex-1"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Type It Out
                </Button>
                <Button
                  variant={inputMethod === "voice" ? "default" : "outline"}
                  onClick={() => setInputMethod("voice")}
                  className="flex-1"
                >
                  <Mic className="h-4 w-4 mr-2" />
                  Record Voice
                </Button>
              </div>

              {/* Text Input */}
              {inputMethod === "text" && (
                <div className="space-y-4">
                  <Textarea
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    placeholder="Example: In March 2024, I transferred $50,000 to what I thought was my bank's investment account. The bank's website showed the transaction was successful, but the money never arrived. When I contacted them, they said it was sent to a scammer and refused to help recover it..."
                    rows={10}
                    className="resize-none text-base"
                  />
                  <p className="text-sm text-muted-foreground">
                    {narrative.length} characters • Aim for at least 100 characters for best results
                  </p>
                </div>
              )}

              {/* Voice Input */}
              {inputMethod === "voice" && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border rounded-lg bg-muted/20">
                    <button
                      onClick={handleVoiceRecording}
                      className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                        isRecording
                          ? "bg-destructive text-destructive-foreground recording-pulse"
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
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm font-medium mb-2">Transcript:</p>
                      <p className="text-sm">{narrative}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Example Prompts */}
              <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg">
                <p className="text-sm font-medium mb-2">💡 What to include:</p>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• What type of financial product (bank account, insurance, investment, etc.)</li>
                  <li>• When the incident happened</li>
                  <li>• What went wrong and how much money is involved</li>
                  <li>• What the institution has said or done about it</li>
                  <li>• Any complaints you{"'"}ve already filed</li>
                </ul>
              </div>

              {/* Submit Button */}
              <Button onClick={handleSubmit} disabled={!narrative.trim() || isProcessing} size="lg" className="w-full">
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing Your Case...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                By continuing, you agree to our{" "}
                <Link href="/privacy" className="underline hover:text-foreground">
                  Privacy Policy
                </Link>
                . Your data is encrypted and anonymized for AI training.
              </p>
            </CardContent>
          </Card>

          {/* Trust Indicators */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="text-center p-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">🔒</span>
              </div>
              <h3 className="font-semibold mb-2">Secure & Private</h3>
              <p className="text-sm text-muted-foreground">
                Your information is encrypted and never shared without permission
              </p>
            </Card>
            <Card className="text-center p-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">⚡</span>
              </div>
              <h3 className="font-semibold mb-2">Instant Analysis</h3>
              <p className="text-sm text-muted-foreground">AI-powered assessment in under 2 minutes</p>
            </Card>
            <Card className="text-center p-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">🎯</span>
              </div>
              <h3 className="font-semibold mb-2">Expert Guidance</h3>
              <p className="text-sm text-muted-foreground">Get personalized next steps based on your situation</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
