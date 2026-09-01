"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Progress } from "@/components/ui/progress"
import { Loader2, ArrowRight, ArrowLeft, RotateCcw } from "lucide-react"
import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { getSessionToken, getRouterSession, updateRouterSession } from "@/lib/router-session"
import { persistAcceptedAnswer, restoreAcceptedResponses } from "./question-persistence"

interface Question {
  key: string
  question: string
  type: "radio" | "text" | "number" | "date"
  options?: string[]
  required: boolean
}

const NOT_SURE_RESPONSE = "I’m not sure"

function parseQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return []
    const question = candidate as Record<string, unknown>
    if (
      typeof question.key !== "string" ||
      typeof question.question !== "string" ||
      !["radio", "text", "number", "date"].includes(String(question.type))
    ) {
      return []
    }

    return [{
      key: question.key,
      question: question.question,
      type: question.type as Question["type"],
      options: Array.isArray(question.options)
        ? question.options.filter((option): option is string => typeof option === "string")
        : undefined,
      required: question.required === true,
    }]
  })
}

export default function QuestionsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const questionHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const saveInFlightRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const loadQuestions = async () => {
      setError(null)
      setIsLoading(true)

      try {
        const sessionToken = getSessionToken()
        if (!sessionToken) {
          router.replace("/router")
          return
        }

        const session = await getRouterSession(sessionToken)
        if (cancelled) return
        if (!session?.classification_result) {
          router.replace("/router")
          return
        }

        if (session.user_responses) {
          setResponses((current) =>
            Object.keys(current).length > 0
              ? current
              : restoreAcceptedResponses(session.user_responses),
          )
        }

        const response = await fetch("/api/router/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_token: sessionToken,
            classification: session.classification_result,
          }),
          signal: controller.signal,
        })

        if (!response.ok) throw new Error("Failed to load questions")

        const data = (await response.json()) as { questions?: unknown }
        const focusedQuestions = parseQuestions(data.questions)
        if (focusedQuestions.length === 0) throw new Error("No focused questions returned")
        if (!cancelled) {
          setQuestions(focusedQuestions)
          setCurrentStep((step) => Math.min(step, focusedQuestions.length - 1))
        }
      } catch (loadError) {
        if (cancelled || (loadError instanceof DOMException && loadError.name === "AbortError")) return
        console.error("Error loading questions:", loadError)
        setError("The focused questions could not be loaded. Your story is still saved.")
        setQuestions([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadQuestions()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [loadAttempt, router])

  const currentQuestion = questions[currentStep]
  const currentResponse = currentQuestion ? responses[currentQuestion.key] ?? "" : ""
  const editableResponse = currentResponse === NOT_SURE_RESPONSE ? "" : currentResponse
  const progress = questions.length > 0 ? ((currentStep + 1) / questions.length) * 100 : 0

  useEffect(() => {
    if (!isLoading && currentQuestion) questionHeadingRef.current?.focus()
  }, [currentQuestion, isLoading])

  useEffect(() => {
    if (error && !isLoading) errorRef.current?.focus()
  }, [error, isLoading])

  const setResponse = (value: string) => {
    if (!currentQuestion || isSubmitting) return
    setError(null)
    setSaveStatus("idle")
    setResponses((current) => ({ ...current, [currentQuestion.key]: value }))
  }

  const handleNext = async () => {
    if (!currentQuestion || saveInFlightRef.current) return
    const acceptedAnswer = responses[currentQuestion.key] ?? ""
    if (currentQuestion.required && !acceptedAnswer) {
      setSaveStatus("idle")
      setError("Answer this question or choose ‘I’m not sure’ before continuing.")
      return
    }

    saveInFlightRef.current = true
    setIsSubmitting(true)
    setSaveStatus("saving")
    setError(null)

    try {
      const sessionToken = getSessionToken()
      if (!sessionToken) throw new Error("No session token")

      await persistAcceptedAnswer({
        sessionToken,
        responses,
        questionKey: currentQuestion.key,
        answer: acceptedAnswer,
        persist: updateRouterSession,
        onPersisted: (acceptedResponses) => {
          setResponses(acceptedResponses)
          setSaveStatus("saved")
          if (currentStep < questions.length - 1) {
            setCurrentStep((step) => step + 1)
          } else {
            router.push("/router/results")
          }
        },
      })
    } catch (submitError) {
      console.error("Error saving response:", submitError)
      setSaveStatus("error")
      setError("This answer could not be saved. It is still here — check your connection and retry.")
    } finally {
      saveInFlightRef.current = false
      setIsSubmitting(false)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setError(null)
      setSaveStatus("idle")
      setCurrentStep((step) => step - 1)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader badge="Free complaint path" />
        <main id="main-content" className="hero-gradient flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
          <div className="gb-container">
            <div className="gb-card mx-auto max-w-lg p-8 text-center" role="status" aria-live="polite">
              <Loader2 className="mx-auto mb-4 size-9 animate-spin text-primary" aria-hidden="true" />
              <h1 className="text-2xl font-semibold text-harbor-deep">Preparing focused questions</h1>
              <p className="mt-3 text-muted-foreground">Using what you shared to keep this step relevant.</p>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (!currentQuestion) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader badge="Free complaint path" />
        <main id="main-content" className="hero-gradient flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
          <div className="gb-container">
            <div ref={errorRef} role="alert" tabIndex={-1} className="gb-card mx-auto max-w-lg p-6 text-center outline-none sm:p-8">
              <h1 className="text-2xl font-semibold text-harbor-deep">Questions are not available</h1>
              <p className="mt-3 leading-7 text-muted-foreground">{error ?? "No focused questions were returned for this complaint."}</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Button onClick={() => setLoadAttempt((current) => current + 1)}>
                  <RotateCcw aria-hidden="true" /> Retry questions
                </Button>
                <Button asChild variant="outline"><Link href="/router">Return to your story</Link></Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader badge="Free complaint path" />
      <main id="main-content" className="hero-gradient min-h-[calc(100vh-4rem)] scroll-pb-32 pb-32 pt-8 sm:scroll-pb-0 sm:py-12">
        <div className="gb-container max-w-2xl">
          <div className="mb-7 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">Complaint path · Step 3</p>
            <h1 className="mt-3 text-3xl font-semibold text-harbor-deep sm:text-4xl">A few focused questions</h1>
            <p className="mt-3 leading-7 text-muted-foreground">Answer one at a time. Choose “I’m not sure” whenever that is the best answer.</p>
          </div>
          <div className="mb-7">
            <div className="mb-2 flex items-center justify-between gap-4">
              <span id="question-progress" aria-live="polite" className="text-sm text-muted-foreground">
                Question {currentStep + 1} of {questions.length}
              </span>
              <span className="text-sm text-muted-foreground">{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-2" aria-labelledby="question-progress" />
          </div>

          <div id="answer-save-status" className="mb-4 min-h-6" aria-live="polite" aria-atomic="true">
            {saveStatus === "saving" && <p role="status" className="text-sm text-muted-foreground">Saving this answer…</p>}
            {saveStatus === "saved" && <p role="status" className="text-sm font-medium text-primary">Answer saved.</p>}
            {error && (
              <div ref={errorRef} role="alert" tabIndex={-1} className="rounded-xl border border-destructive/40 bg-harbor-error-tint p-4 outline-none">
                <p>{error}</p>
                {saveStatus === "error" && (
                  <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void handleNext()} disabled={isSubmitting}>
                    <RotateCcw aria-hidden="true" /> Retry saving
                  </Button>
                )}
              </div>
            )}
          </div>

          <Card className="mb-7 border-primary/15 shadow-sm">
            <CardHeader>
              <p className="text-sm font-medium text-muted-foreground">{currentQuestion.required ? "Required" : "Optional"}</p>
              <CardTitle ref={questionHeadingRef} id="current-question" tabIndex={-1} className="text-xl leading-8 text-harbor-deep outline-none sm:text-2xl">
                {currentQuestion.question}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentQuestion.type === "radio" && (
                <RadioGroup
                  value={currentResponse}
                  aria-labelledby="current-question"
                  disabled={isSubmitting}
                  onValueChange={setResponse}
                  className="gap-2"
                >
                  {currentQuestion.options?.map((option, index) => {
                    const optionId = `${currentQuestion.key}-option-${index}`
                    return (
                      <div key={`${option}-${index}`} className="flex min-h-11 items-center gap-3 rounded-xl border p-3 hover:bg-muted/50">
                        <RadioGroupItem value={option} id={optionId} />
                        <Label htmlFor={optionId} className="flex-1 cursor-pointer leading-6">
                          {option}
                        </Label>
                      </div>
                    )
                  })}
                </RadioGroup>
              )}

              {currentQuestion.type === "text" && (
                <>
                  <Label htmlFor={`response-${currentQuestion.key}`} className="sr-only">{currentQuestion.question}</Label>
                  <Input
                    id={`response-${currentQuestion.key}`}
                    value={editableResponse}
                    disabled={isSubmitting}
                    onChange={(event) => setResponse(event.target.value)}
                    placeholder="Your answer"
                  />
                </>
              )}

              {currentQuestion.type === "number" && (
                <>
                  <Label htmlFor={`response-${currentQuestion.key}`} className="sr-only">{currentQuestion.question}</Label>
                  <Input
                    id={`response-${currentQuestion.key}`}
                    type="number"
                    value={editableResponse}
                    disabled={isSubmitting}
                    onChange={(event) => setResponse(event.target.value)}
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
                    value={editableResponse}
                    disabled={isSubmitting}
                    onChange={(event) => setResponse(event.target.value)}
                  />
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:flex sm:items-center">
            <div className="grid grid-cols-2 gap-3 sm:contents">
              <Button variant="outline" onClick={handleBack} disabled={currentStep === 0 || isSubmitting}>
                <ArrowLeft aria-hidden="true" /> Back
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={currentResponse === NOT_SURE_RESPONSE}
                disabled={isSubmitting}
                onClick={() => setResponse(NOT_SURE_RESPONSE)}
                className="sm:ml-auto"
              >
                I’m not sure
              </Button>
            </div>
            <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <Button className="min-h-12 w-full sm:w-auto" onClick={() => void handleNext()} disabled={isSubmitting} aria-describedby="answer-save-status">
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" /> Saving answer…
                  </>
                ) : saveStatus === "error" ? (
                  <>
                    Retry and continue <ArrowRight aria-hidden="true" />
                  </>
                ) : currentStep === questions.length - 1 ? (
                  "Save and see result"
                ) : (
                  <>
                    Save and continue <ArrowRight aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
