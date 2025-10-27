"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Loader2, ArrowRight, ArrowLeft } from "lucide-react"
import Link from "next/link"
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
      } catch (error) {
        console.error("[v0] Error loading questions:", error)
        alert("Something went wrong. Please try again.")
        router.push("/router")
      } finally {
        setIsLoading(false)
      }
    }

    loadQuestions()
  }, [router])

  const currentQuestion = questions[currentStep]
  const progress = ((currentStep + 1) / questions.length) * 100

  const handleNext = async () => {
    if (currentQuestion.required && !responses[currentQuestion.key]) {
      return
    }

    if (currentStep < questions.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      await handleSubmit()
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)

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
    } catch (error) {
      console.error("[v0] Error submitting responses:", error)
      alert("Something went wrong. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading questions...</p>
        </div>
      </div>
    )
  }

  if (!currentQuestion) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <Badge variant="secondary">Free Assessment</Badge>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto">
          {/* Progress */}
          <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-muted-foreground">
                Question {currentStep + 1} of {questions.length}
              </span>
              <span className="text-sm text-muted-foreground">{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Question Card */}
          <Card className="shadow-lg mb-8">
            <CardHeader>
              <CardTitle className="text-xl">{currentQuestion.question}</CardTitle>
            </CardHeader>
            <CardContent>
              {currentQuestion.type === "radio" && (
                <RadioGroup
                  value={responses[currentQuestion.key] || ""}
                  onValueChange={(value) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: value }))}
                >
                  {currentQuestion.options?.map((option) => (
                    <div key={option} className="flex items-center space-x-2 p-3 rounded-lg hover:bg-muted/50">
                      <RadioGroupItem value={option} id={option} />
                      <Label htmlFor={option} className="flex-1 cursor-pointer">
                        {option}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              )}

              {currentQuestion.type === "text" && (
                <Input
                  value={responses[currentQuestion.key] || ""}
                  onChange={(e) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))}
                  placeholder="Your answer..."
                />
              )}

              {currentQuestion.type === "number" && (
                <Input
                  type="number"
                  value={responses[currentQuestion.key] || ""}
                  onChange={(e) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))}
                  placeholder="0"
                />
              )}

              {currentQuestion.type === "date" && (
                <Input
                  type="date"
                  value={responses[currentQuestion.key] || ""}
                  onChange={(e) => setResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))}
                />
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
      </div>
    </div>
  )
}
