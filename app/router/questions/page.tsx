"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Progress } from "@/components/ui/progress"
import { Loader2, ArrowRight, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { getSessionToken, getRouterSession, updateRouterSession } from "@/lib/router-session"

interface Question {
  key: string
  question: string
  type: "radio" | "text" | "number" | "date"
  options?: string[]
  required: boolean
}

export default function QuestionsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const questionHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const loadQuestions = async () => {
      try {
        const sessionToken = getSessionToken()
        if (!sessionToken) {
          router.push("/router")
          return
        }

        const session = await getRouterSession(sessionToken)
        if (!session || !session.classification_result) {
          router.push("/router")
          return
        }

        // Generate personalized questions based on classification
        const response = await fetch("/api/router/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_token: sessionToken,
            classification: session.classification_result,
          }),
        })

        if (!response.ok) {
          throw new Error("Failed to load questions")
        }

        const data = await response.json()
        setQuestions(data.questions)
      } catch (loadError) {
        console.error("Error loading questions:", loadError)
        setError("The focused questions could not be loaded. Your story is still saved.")
      } finally {
        setIsLoading(false)
      }
    }

    loadQuestions()
  }, [router])

  const currentQuestion = questions[currentStep]
  const progress = ((currentStep + 1) / questions.length) * 100

  useEffect(() => {
    if (currentStep > 0) questionHeadingRef.current?.focus()
  }, [currentStep])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  const handleNext = async () => {
    if (currentQuestion.required && !responses[currentQuestion.key]) {
      setError("Answer this question before continuing.")
      return
    }

    setError(null)
    if (currentStep < questions.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      await handleSubmit()
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setError(null)
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const sessionToken = getSessionToken()
      if (!sessionToken) {
        throw new Error("No session token")
      }

      // Update session with responses
      await updateRouterSession(sessionToken, {
        user_responses: responses,
      })

      // Redirect to results
      router.push("/router/results")
    } catch (submitError) {
      console.error("Error submitting responses:", submitError)
      setError("Your answers could not be saved. They are still here — check your connection and try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main id="main-content" className="gb-container flex min-h-[70vh] items-center justify-center py-12">
          <div className="text-center" role="status" aria-live="polite">
            <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" aria-hidden="true" />
            <p className="text-muted-foreground">Loading questions…</p>
          </div>
        </main>
      </div>
    )
  }

  if (!currentQuestion) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div role="alert" className="gb-card max-w-lg p-6 text-center">
          <h1 className="text-xl font-semibold">Questions are not available</h1>
          <p className="mt-3 text-muted-foreground">{error ?? "No focused questions were returned for this complaint."}</p>
          <Button asChild className="mt-5"><Link href="/router">Return to your story</Link></Button>
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main id="main-content" className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto">
          {/* Progress */}
          <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
              <span aria-live="polite" className="text-sm text-muted-foreground">
                Question {currentStep + 1} of {questions.length}
              </span>
              <span className="text-sm text-muted-foreground">{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {error && (
            <div ref={errorRef} role="alert" tabIndex={-1} className="mb-4 rounded-xl border border-destructive/40 bg-harbor-error-tint p-4">
              {error}
            </div>
          )}

          {/* Question Card */}
          <Card className="shadow-lg mb-8">
            <CardHeader>
              <CardTitle ref={questionHeadingRef} id="current-question" tabIndex={-1} className="text-xl outline-none">{currentQuestion.question}</CardTitle>
            </CardHeader>
            <CardContent>
              {currentQuestion.type === "radio" && (
                <RadioGroup
                  value={responses[currentQuestion.key] || ""}
                  aria-labelledby="current-question"
                  onValueChange={(value) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: value }))}
                >
                  {currentQuestion.options?.map((option) => (
                    <div key={option} className="flex items-center space-x-2 p-3 rounded-lg hover:bg-muted/50">
                      <RadioGroupItem value={option} id={`${currentQuestion.key}-${option}`} />
                      <Label htmlFor={`${currentQuestion.key}-${option}`} className="flex-1 cursor-pointer">
                        {option}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              )}

              {currentQuestion.type === "text" && (
                <>
                  <Label htmlFor={`response-${currentQuestion.key}`} className="sr-only">{currentQuestion.question}</Label>
                  <Input
                    id={`response-${currentQuestion.key}`}
                    value={responses[currentQuestion.key] || ""}
                    onChange={(e) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))}
                    placeholder="Your answer..."
                  />
                </>
              )}

              {currentQuestion.type === "number" && (
                <>
                  <Label htmlFor={`response-${currentQuestion.key}`} className="sr-only">{currentQuestion.question}</Label>
                  <Input
                    id={`response-${currentQuestion.key}`}
                    type="number"
                    value={responses[currentQuestion.key] || ""}
                    onChange={(e) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))}
                    placeholder="0"
                  />
                </>
              )}

              {currentQuestion.type === "date" && (
                <>
                  <Label htmlFor={`response-${currentQuestion.key}`} className="sr-only">{currentQuestion.question}</Label>
                  <Input
                    id={`response-${currentQuestion.key}`}
                    type="date"
                    value={responses[currentQuestion.key] || ""}
                    onChange={(e) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))}
                  />
                </>
              )}
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex justify-between gap-4">
            <Button variant="outline" onClick={handleBack} disabled={currentStep === 0 || isSubmitting}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={handleNext}
              disabled={(currentQuestion.required && !responses[currentQuestion.key]) || isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : currentStep === questions.length - 1 ? (
                "See Results"
              ) : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
