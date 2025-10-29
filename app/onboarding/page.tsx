"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, CheckCircle, ArrowRight, User, Bell, FileText, Sparkles } from "lucide-react"
import Link from "next/link"
import { trackClientEvent } from "@/lib/analytics/client"
import { updateRouterSession, consumeConvertedRouterSessionToken } from "@/lib/router-session"
import type { RouterSession } from "@/lib/router-session"

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [hasRouterSession, setHasRouterSession] = useState(false)
  const [routerSessionData, setRouterSessionData] = useState<RouterSession | null>(null)

  // Form data
  const [fullName, setFullName] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [smsNotifications, setSmsNotifications] = useState(false)
  const [importCase, setImportCase] = useState(false)
  const [importedCaseId, setImportedCaseId] = useState<string | null>(null)

  const router = useRouter()
  const totalSteps = 4

  const normaliseClaimType = (value?: string | null) => {
    const normalized = (value || "").toLowerCase()
    if (normalized.includes("mis") || normalized.includes("product")) return "mis_sold_product"
    if (normalized.includes("denied") || normalized.includes("insurance")) return "denied_insurance"
    return "phishing_scam"
  }

  const deriveEligibilityStatus = (recommendation?: string) => {
    if (!recommendation) return "pending"
    const normalized = recommendation.toLowerCase()
    if (normalized.includes("police")) return "out_of_scope"
    if (normalized.includes("financial")) return "pending"
    return "pending"
  }

  const deriveStrengthScore = (score?: number) => {
    if (typeof score !== "number") return null
    if (score >= 70) return "high"
    if (score >= 40) return "medium"
    return "low"
  }

  useEffect(() => {
    const initOnboarding = async () => {
      const supabase = createClient()

      // Get current user
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      if (!currentUser) {
        router.push("/auth/login")
        return
      }

      setUser(currentUser)

      const retrieveSessionByToken = async (token: string) => {
        try {
          const res = await fetch(`/api/router/session?token=${encodeURIComponent(token)}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "include",
          })
          if (!res.ok) {
            return false
          }
          const { session } = (await res.json()) as { session: RouterSession | null }
          if (session) {
            setHasRouterSession(true)
            setRouterSessionData(session)
            setImportCase(true)
            return true
          }
        } catch (err) {
          console.error("[v0] Session fetch by token failed:", err)
        }
        return false
      }

      let sessionLoaded = false
      const convertedToken = consumeConvertedRouterSessionToken()
      if (convertedToken) {
        sessionLoaded = await retrieveSessionByToken(convertedToken)
      }

      if (!sessionLoaded) {
        // Fall back to fetching by user id
        try {
          const res = await fetch(`/api/router/session?convertedFor=${encodeURIComponent(currentUser.id)}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "include",
          })
          if (res.ok) {
            const { session } = (await res.json()) as { session: RouterSession | null }
            if (session) {
              setHasRouterSession(true)
              setRouterSessionData(session)
              setImportCase(true)
            } else {
              setHasRouterSession(false)
              setImportCase(false)
            }
          } else if (res.status === 404) {
            setHasRouterSession(false)
            setImportCase(false)
          } else {
            const body = await res.text()
            console.error("[v0] Converted session fetch error:", res.status, body)
            setHasRouterSession(false)
            setImportCase(false)
          }
        } catch (err) {
          console.error("[v0] Failed to fetch converted router session:", err)
          setHasRouterSession(false)
          setImportCase(false)
        }
      }

      setIsLoading(false)
    }

    initOnboarding()
  }, [router])

  const handleNext = async () => {
    if (!user) {
      return
    }
    if (currentStep === 1) {
      // Save profile data
      setIsSaving(true)
      const supabase = createClient()

      try {
        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email,
          full_name: fullName,
          phone_number: phoneNumber,
          updated_at: new Date().toISOString(),
        })

        // Track onboarding step
        await trackClientEvent({
          eventName: "onboarding_step_complete",
          userId: user.id,
          eventData: { step: 1, step_name: "profile" },
        })
      } catch (error) {
        console.error("[v0] Error saving profile:", error)
      } finally {
        setIsSaving(false)
      }
    }

    if (currentStep === 2 && hasRouterSession && importCase) {
      if (!routerSessionData) {
        setHasRouterSession(false)
        setImportCase(false)
        return setCurrentStep((step) => Math.min(totalSteps, step + 1))
      }

      setIsSaving(true)
      const supabase = createClient()

      try {
        const classification = (routerSessionData.classification_result ?? {}) as Record<string, any>
        const eligibility = (routerSessionData.eligibility_assessment ?? {}) as Record<string, any>

        const claimTypeValue =
          typeof classification.claimType === "string"
            ? classification.claimType
            : typeof classification.claim_type === "string"
              ? classification.claim_type
              : undefined

        const mappedClaimType = normaliseClaimType(claimTypeValue)
        const recommendation =
          typeof classification.recommendation === "string" ? classification.recommendation : undefined
        const caseSummary = typeof classification.summary === "string" ? classification.summary : null
        const eligibilityScore =
          typeof eligibility.eligibility_score === "number" ? eligibility.eligibility_score : undefined

        console.log("[onboarding] Fetching current session before case insert...")
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !sessionData?.session) {
          console.error("[onboarding] CRITICAL: No active session found before case insert!", sessionError)
          throw sessionError ?? new Error("User session not found. Cannot save case.")
        }
        const currentUserId = sessionData.session.user.id
        console.log("[onboarding] Current session user ID:", currentUserId)

        const casePayload = {
          user_id: currentUserId,
          owner_user_id: currentUserId,
          creator_user_id: currentUserId,
          claim_type: mappedClaimType,
          status: "intake",
          case_summary: caseSummary,
          eligibility_status: deriveEligibilityStatus(recommendation),
          strength_score: deriveStrengthScore(eligibilityScore),
        }
        console.log("[onboarding] Preparing to insert case. Payload:", JSON.stringify(casePayload, null, 2))

        const { data: newCase, error: caseError } = await supabase.from("cases").insert(casePayload).select().single()

        if (caseError) {
          throw caseError
        }

        if (newCase?.id) {
          setImportedCaseId(newCase.id)

          try {
            await updateRouterSession(routerSessionData.session_token, {
              converted_to_case_id: newCase.id,
              converted_to_user_id: user.id,
              converted_at: new Date().toISOString(),
            })

            setRouterSessionData((prev) =>
              prev
                ? {
                    ...prev,
                    converted_to_case_id: newCase.id,
                    converted_to_user_id: user.id,
                    converted_at: new Date().toISOString(),
                  }
                : prev,
            )
          } catch (sessionUpdateError) {
            console.error("[v0] Failed to mark router session as converted:", sessionUpdateError)
          }
        }

        await trackClientEvent({
          eventName: "onboarding_case_imported",
          userId: user.id,
          eventData: { case_id: newCase?.id, from_router: true },
        })
      } catch (error) {
        console.error("[v0] Error importing case:", error)
        setImportedCaseId(null)
      } finally {
        setIsSaving(false)
      }
    } else if (currentStep === 2) {
      setImportedCaseId(null)
    }


    if (currentStep === 3) {
      // Save notification preferences
      setIsSaving(true)
      const supabase = createClient()

      try {
        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email,
          email_notifications: emailNotifications,
          sms_notifications: smsNotifications,
          updated_at: new Date().toISOString(),
        })

        // Track onboarding step
        await trackClientEvent({
          eventName: "onboarding_step_complete",
          userId: user.id,
          eventData: { step: 3, step_name: "notifications" },
        })
      } catch (error) {
        console.error("[v0] Error saving preferences:", error)
      } finally {
        setIsSaving(false)
      }
    }

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    } else {
      // Complete onboarding
      await trackClientEvent({
        eventName: "onboarding_complete",
        userId: user.id,
        eventData: { total_steps: totalSteps },
      })

      const destination = importedCaseId ? `/app/case/${importedCaseId}/dashboard` : "/app"
      router.push(destination)
    }
  }

  const handleSkip = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    } else {
      router.push("/app")
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
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
            <Badge variant="secondary">
              Step {currentStep} of {totalSteps}
            </Badge>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto">
          {/* Progress Bar */}
          <div className="mb-8">
            <Progress value={(currentStep / totalSteps) * 100} className="h-2" />
          </div>

          {/* Step 1: Profile */}
          {currentStep === 1 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Complete Your Profile</CardTitle>
                    <CardDescription>Help us personalize your experience</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">Phone Number (Optional)</Label>
                  <Input
                    id="phoneNumber"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+65 1234 5678"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <Button onClick={handleNext} disabled={!fullName || isSaving} className="flex-1">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Continue
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <Button onClick={handleSkip} variant="outline">
                    Skip
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Case Import */}
          {currentStep === 2 && (
            <Card>
            <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Import Your Case</CardTitle>
                    <CardDescription>
                      {hasRouterSession
                        ? "We've saved your dispute assessment."
                        : "Import your saved assessment once it becomes available."}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasRouterSession ? (
                  <>
                    <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg">
                      <div className="flex items-start gap-3">
                        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                        <div>
                          <p className="font-medium text-sm">Case Assessment Ready</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            We found your dispute assessment from the router. Import it to continue where you left off.
                          </p>
                          {routerSessionData?.eligibility_assessment && (
                            <div className="mt-3 space-y-1">
                              <p className="text-xs text-muted-foreground">
                                <strong>Recommended Path:</strong>{" "}
                                {routerSessionData.eligibility_assessment.recommended_path}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                <strong>Eligibility Score:</strong>{" "}
                                {routerSessionData.eligibility_assessment.eligibility_score}/100
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2">
                      <Checkbox
                        id="importCase"
                        checked={importCase}
                        disabled={!hasRouterSession}
                        onCheckedChange={(checked) => setImportCase(checked as boolean)}
                      />
                      <Label htmlFor="importCase" className="text-sm leading-relaxed">
                        Yes, import my case assessment and continue with this dispute
                      </Label>
                    </div>
                  </>
                ) : (
                  <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg text-center">
                    <p className="text-sm">No saved assessment found. You can start a new case from your dashboard.</p>
                  </div>
                )}
                <div className="flex gap-3 pt-4">
                  <Button onClick={handleNext} disabled={isSaving} className="flex-1">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Continue
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <Button onClick={handleSkip} variant="outline">
                    Skip
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Notifications */}
          {currentStep === 3 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bell className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Notification Preferences</CardTitle>
                    <CardDescription>Stay updated on your case progress</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="emailNotifications"
                      checked={emailNotifications}
                      onCheckedChange={(checked) => setEmailNotifications(checked as boolean)}
                    />
                    <div>
                      <Label htmlFor="emailNotifications" className="text-sm font-medium">
                        Email Notifications
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Get updates about case progress, deadlines, and important actions
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="smsNotifications"
                      checked={smsNotifications}
                      onCheckedChange={(checked) => setSmsNotifications(checked as boolean)}
                    />
                    <div>
                      <Label htmlFor="smsNotifications" className="text-sm font-medium">
                        SMS Notifications
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Receive urgent updates via text message (requires phone number)
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button onClick={handleNext} disabled={isSaving} className="flex-1">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Continue
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <Button onClick={handleSkip} variant="outline">
                    Skip
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 4: Welcome Tour */}
          {currentStep === 4 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>You're All Set!</CardTitle>
                    <CardDescription>Here's what you can do next</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-blue-600">1</span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">Review Your Case Dashboard</p>
                      <p className="text-sm text-muted-foreground">
                        Track your case progress, upload documents, and manage deadlines
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-blue-600">2</span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">Upload Supporting Documents</p>
                      <p className="text-sm text-muted-foreground">
                        Add bank statements, correspondence, and other evidence
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-blue-600">3</span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">Generate Your FIDReC Complaint</p>
                      <p className="text-sm text-muted-foreground">
                        Our AI will help you draft a professional complaint letter
                      </p>
                    </div>
                  </div>
                </div>
                <Button onClick={handleNext} className="w-full" size="lg">
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}




