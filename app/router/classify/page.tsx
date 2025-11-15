"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { getSessionToken, getRouterSession, updateRouterSession } from "@/lib/router-session"

export default function ClassifyPage() {
  const [isAnalyzing, setIsAnalyzing] = useState(true)
  const [classification, setClassification] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const analyzeDispute = async () => {
      try {
        const sessionToken = getSessionToken()
        if (!sessionToken) {
          router.push("/router")
          return
        }

        const session = await getRouterSession(sessionToken)
      if (!session || !session.dispute_narrative) {
          router.push("/router")
          return
        }

        // Call AI classification API
        const response = await fetch("/api/router/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_token: sessionToken,
            narrative: session.dispute_narrative,
          }),
        })

        if (!response.ok) {
          throw new Error("Classification failed")
        }

        const result = await response.json()
        setClassification(result)

        // Update session with classification
        await updateRouterSession(sessionToken, {
          classification_result: result,
        })

        // Auto-redirect after 2 seconds
        setTimeout(() => {
          router.push("/router/questions")
        }, 2000)
      } catch (err) {
        console.error("[v0] Error analyzing incident:", err)
        setError("Something went wrong. Please try again.")
      } finally {
        setIsAnalyzing(false)
      }
    }

    analyzeDispute()
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-center">Analysis Error</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={() => router.push("/router")} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full rounded-xl shadow-lg">
        <CardHeader>
          <div className="flex justify-center mb-4">
            {isAnalyzing ? (
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
            ) : (
              <CheckCircle className="h-12 w-12 text-accent" />
            )}
          </div>
          <CardTitle className="text-center text-2xl text-balance">
            {isAnalyzing ? "Analyzing Your Dispute..." : "Analysis Complete"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isAnalyzing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <p className="text-sm text-muted-foreground">Reading your narrative...</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse delay-100" />
                <p className="text-sm text-muted-foreground">Identifying report type...</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse delay-200" />
                <p className="text-sm text-muted-foreground">Checking eligibility criteria...</p>
              </div>
            </div>
          ) : (
            classification && (
              <div className="space-y-4">
                <div className="bg-accent/10 p-4 rounded-xl">
                  <p className="font-semibold mb-2">Dispute Category:</p>
                  <Badge variant="secondary" className="text-base bg-accent text-accent-foreground">
                    {classification.category || "Financial Dispute"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Preparing personalized questions to assess your case...
                </p>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  )
}
