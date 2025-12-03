"use client"

import type React from "react"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Heart, User as UserIcon } from "lucide-react"

import { useSupabase } from "@/components/providers/supabase-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { trackClientEvent } from "@/lib/analytics/client"
import type { RouterSession } from "@/lib/router-session"
import { clearSessionToken, getSessionToken, persistConvertedRouterSessionToken } from "@/lib/router-session"

type RegisterApiResponse = {
  success: boolean
  user: {
    id: string
    email?: string | null
    [key: string]: unknown
  }
  sessionLinked?: boolean
  routerSession?: RouterSession | null
  sessionLinkError?: string | null
  consentLogged?: boolean
  welcomeEmailSent?: boolean
  error?: string
}

type StoredVerifiedUser = {
  userId: string
  email: string
}

type VerifiedUserState = {
  id: string
  email: string
} | null

const PENDING_EMAIL_KEY = "signup_pending_email"
const VERIFIED_USER_KEY = "signup_verified_user"
const RESEND_TIMEOUT_SECONDS = 30
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isValidEmail = (value: string) => emailPattern.test(value.trim().toLowerCase())

const readVerifiedUserFromStorage = (): StoredVerifiedUser | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(VERIFIED_USER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredVerifiedUser
  } catch {
    return null
  }
}

const persistVerifiedUserToStorage = (payload: StoredVerifiedUser) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(VERIFIED_USER_KEY, JSON.stringify(payload))
}

const clearVerifiedUserStorage = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(VERIFIED_USER_KEY)
}

const persistPendingEmail = (email: string) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(PENDING_EMAIL_KEY, email)
}

const readPendingEmail = () => {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(PENDING_EMAIL_KEY) ?? ""
}

const clearPendingEmail = () => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(PENDING_EMAIL_KEY)
}

export default function SignUpPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()
  const source = searchParams.get("source")
  const emailParam = searchParams.get("email")
  const verifiedParam = searchParams.get("verified")
  const codeParam = searchParams.get("code")
  const isFromRouter = source === "router"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"victim" | "helper">("victim")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [signupStarted, setSignupStarted] = useState(false)
  const [verificationStatus, setVerificationStatus] = useState<"idle" | "sending" | "sent" | "verified" | "error">("idle")
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [verifiedUser, setVerifiedUser] = useState<VerifiedUserState>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [checkingVerification, setCheckingVerification] = useState(false)

  const pdpaConsentPurposes = [
    "Account creation and management",
    "Case processing and document generation",
    "Communication about your case progress",
    "Platform improvements and analytics",
    "Legal compliance and record keeping",
  ]

  const isEmailVerified = Boolean(verifiedUser)

  useEffect(() => {
    if (emailParam) {
      setEmail(emailParam)
      return
    }
    if (!email) {
      const stored = readPendingEmail()
      if (stored) {
        setEmail(stored)
      }
    }
  }, [emailParam, email])

  useEffect(() => {
    if (email) {
      persistPendingEmail(email)
    }
  }, [email])

  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = window.setInterval(() => {
      setResendCountdown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [resendCountdown])

  useEffect(() => {
    if (isFromRouter) {
      trackEvent("router_conversion_start", {
        page: "signup",
        source: "router",
        timestamp: new Date().toISOString(),
      })
    }

    const handleFirstFocus = () => {
      if (!signupStarted) {
        setSignupStarted(true)
        trackEvent("signup_start", {
          page: "signup",
          source: source || "direct",
          timestamp: new Date().toISOString(),
        })
      }
    }

    const emailInput = document.getElementById("email")
    emailInput?.addEventListener("focus", handleFirstFocus, { once: true })

    return () => {
      emailInput?.removeEventListener("focus", handleFirstFocus)
    }
  }, [signupStarted, isFromRouter, source])

  useEffect(() => {
    const hasQueryVerification = verifiedParam === "1"
    const hasOtpCode = Boolean(codeParam)
    const stored = readVerifiedUserFromStorage()
    let active = true

    const loadUserFromSession = async (reason: string) => {
      try {
        const { data } = await supabase.auth.getUser()
        if (!active) return
        const user = data?.user
        if (!user || !user.email) return
        const normalizedUserEmail = user.email.toLowerCase()
        const normalizedParamEmail = emailParam?.toLowerCase()
        const storedMatches = stored?.userId === user.id
        const shouldTrust = hasQueryVerification || hasOtpCode || storedMatches || !!user.email_confirmed_at

        if (!shouldTrust) return

        if (hasQueryVerification && normalizedParamEmail && normalizedParamEmail !== normalizedUserEmail) {
          setVerificationStatus("error")
          setVerificationError("Email mismatch detected. Please request a new verification link.")
          return
        }

        setVerifiedUser({ id: user.id, email: user.email })
        setEmail(user.email)
        persistPendingEmail(user.email)
        persistVerifiedUserToStorage({ userId: user.id, email: user.email })
        setVerificationStatus("verified")
        setVerificationMessage("Email verified. Continue below to finish creating your account.")
        setVerificationError(null)
      } catch (err) {
        if (!active) return
        console.error("[signup] Failed to load session:", err)
      }
    }

    const exchangeAndLoadUser = async () => {
      setCheckingVerification(true)
      try {
        if (hasOtpCode) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(codeParam as string)
          if (exchangeError) throw exchangeError
        }
        await loadUserFromSession("exchange")
      } catch (err) {
        if (!active) return
        console.warn("[signup] Waiting for email confirmation; could not exchange code yet:", err)
        setVerificationStatus("idle")
        setVerificationError(null)
      } finally {
        if (active) setCheckingVerification(false)
      }
    }

    if (hasOtpCode || hasQueryVerification || stored) {
      void exchangeAndLoadUser()
    } else {
      // Initial background check for existing session (e.g., cookie set by confirmation tab)
      void loadUserFromSession("initial")
    }

    const handleFocus = () => void loadUserFromSession("focus")
    window.addEventListener("focus", handleFocus)

    return () => {
      active = false
      window.removeEventListener("focus", handleFocus)
    }
  }, [supabase, verifiedParam, emailParam, codeParam])

  const trackEvent = async (eventName: string, eventData: Record<string, unknown>) => {
    await trackClientEvent({
      eventName,
      eventData,
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    })
  }

  const resetVerificationState = () => {
    setVerifiedUser(null)
    setVerificationStatus("idle")
    setVerificationMessage(null)
    setVerificationError(null)
    setResendCountdown(0)
    clearVerifiedUserStorage()
  }

  const handleEmailChange = (value: string) => {
    setEmail(value)
    if (!verifiedUser) {
      setVerificationStatus("idle")
      setVerificationMessage(null)
      setVerificationError(null)
      setResendCountdown(0)
    }
  }

  const handleRequestVerification = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (isEmailVerified) return

    const normalizedEmail = email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      setVerificationStatus("error")
      setVerificationError("Please enter a valid email address.")
      return
    }

    setVerificationStatus("sending")
    setVerificationError(null)
    setVerificationMessage(null)

    try {
      const response = await fetch("/api/auth/pre-verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, source }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to send verification link")
      }

      persistPendingEmail(normalizedEmail)
      setEmail(normalizedEmail)
      setVerificationStatus("sent")
      setVerificationMessage("Check your inbox for a confirmation link from GuideBuoy AI.")
      setResendCountdown(RESEND_TIMEOUT_SECONDS)

      await trackEvent("signup_email_verification_sent", {
        email: normalizedEmail,
        source: source || "direct",
        timestamp: new Date().toISOString(),
      })
    } catch (requestError) {
      console.error("[signup] Verification link error:", requestError)
      setVerificationStatus("error")
      setVerificationError(
        requestError instanceof Error ? requestError.message : "Unable to send verification link right now.",
      )
    }
  }

  const handleResendVerification = async () => {
    if (isEmailVerified || verificationStatus === "sending" || resendCountdown > 0 || !isValidEmail(email)) {
      return
    }
    await handleRequestVerification()
  }

  const handleResetVerification = async () => {
    resetVerificationState()
    clearPendingEmail()
    setEmail("")
    setPassword("")
    setAgreedToTerms(false)
    setRole("victim")
    try {
      await supabase.auth.signOut()
    } catch (signOutError) {
      console.error("[signup] Failed to sign out after verification reset:", signOutError)
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete("verified")
    params.delete("email")
    const nextQuery = params.toString()
    router.replace(`/auth/sign-up${nextQuery ? `?${nextQuery}` : ""}`)
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!verifiedUser) {
      setError("Please verify your email before creating your account.")
      return
    }

    if (!agreedToTerms) {
      setError("Please agree to the Terms and Privacy Policy")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    setIsLoading(true)
    setError(null)

    const sessionToken = isFromRouter ? getSessionToken() : null
    const consentPayload = {
      purposes: pdpaConsentPurposes,
      policyVersion: "1.0",
      consentedAt: new Date().toISOString(),
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: verifiedUser.email,
          password,
          role,
          sessionToken,
          consent: consentPayload,
          preverifiedUserId: verifiedUser.id,
        }),
      })

      let result: RegisterApiResponse | null = null
      try {
        result = (await response.json()) as RegisterApiResponse
      } catch (parseError) {
        console.error("[signup] Failed to parse register API response:", parseError)
      }

      if (!response.ok || !result?.success || !result.user) {
        const errorMessage = result?.error || "Registration failed"
        setError(errorMessage)
        if (!response.ok) {
          console.error("[signup] Register API error response:", result)
        }
        return
      }

      const {
        user,
        sessionLinked = false,
        routerSession,
        sessionLinkError,
        consentLogged,
        welcomeEmailSent,
      } = result
      const userId = user.id

      await trackEvent("signup_complete", {
        user_id: userId,
        email: verifiedUser.email,
        role,
        source: source || "direct",
        timestamp: new Date().toISOString(),
      })

      await trackEvent("consent_accepted", {
        user_id: userId,
        purposes: pdpaConsentPurposes,
        timestamp: new Date().toISOString(),
      })

      // Ensure the user has a local session after registration
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: verifiedUser.email,
          password,
        })
        if (signInError) {
          console.error("[signup] Post-register sign-in failed:", signInError)
        }
      } catch (signInUnexpected) {
        console.error("[signup] Unexpected error during post-register sign-in:", signInUnexpected)
      }

      if (isFromRouter && sessionToken) {
        if (sessionLinked) {
          persistConvertedRouterSessionToken(sessionToken)

          await trackClientEvent({
            eventName: "router_conversion_complete",
            userId,
            sessionId: sessionToken,
            eventData: {
              session_id: routerSession?.id,
              recommended_path: routerSession?.recommended_path,
              eligibility_score: routerSession?.eligibility_assessment?.eligibility_score,
            },
            pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          })

          clearSessionToken()
        } else if (sessionLinkError) {
          console.warn("[signup] Router session linking failed:", sessionLinkError)
        } else {
          console.warn("[signup] Router session token present but link was not confirmed.")
        }
      }

      if (consentLogged === false) {
        console.warn("[signup] Consent log was not recorded for user:", userId)
      }
      if (welcomeEmailSent === false) {
        console.warn("[signup] Welcome email was not sent for user:", userId)
      }

      clearPendingEmail()
      clearVerifiedUserStorage()

      router.push("/onboarding")
    } catch (requestError: unknown) {
      console.error("[signup] Unexpected signup error:", requestError)
      setError(requestError instanceof Error ? requestError.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const verificationButtonLabel = isEmailVerified
    ? "Email verified"
    : verificationStatus === "sending"
      ? "Sending..."
      : "Send verification link"

  const canResend =
    !isEmailVerified && verificationStatus === "sent" && resendCountdown === 0 && isValidEmail(email) && !checkingVerification

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <div className="text-center">
            <Link
              href="/app"
              className="flex items-center justify-center gap-2 mb-6 hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            {isFromRouter && (
              <div className="mb-4">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/20 text-accent-foreground text-sm font-medium">
                  🚢 Your case assessment is ready
                </span>
              </div>
            )}
          </div>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-2xl">Create Account</CardTitle>
              <CardDescription>
                {isEmailVerified
                  ? "Great! We confirmed your email. Finish setting up your GuideBuoy AI account."
                  : "Start by confirming your email address so we can secure your account."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8">
                <form onSubmit={handleRequestVerification} className="space-y-3">
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        required
                        value={email}
                        onChange={(e) => handleEmailChange(e.target.value)}
                        disabled={isEmailVerified || verificationStatus === "sending"}
                        className="rounded-xl flex-1"
                      />
                      <Button
                        type="submit"
                        className="rounded-full whitespace-nowrap"
                        disabled={
                          isEmailVerified ||
                          verificationStatus === "sending" ||
                          !isValidEmail(email) ||
                          checkingVerification
                        }
                      >
                        {verificationButtonLabel}
                      </Button>
                    </div>
                  </div>

                  {verificationMessage && <p className="text-sm text-muted-foreground">{verificationMessage}</p>}
                  {verificationError && <p className="text-sm text-destructive">{verificationError}</p>}

                  {!isEmailVerified && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Didn{"'"}t get an email?</span>
                      <Button
                        type="button"
                        variant="link"
                        className="px-0 py-0 h-auto"
                        disabled={!canResend}
                        onClick={handleResendVerification}
                      >
                        Resend verification link
                        {resendCountdown > 0 ? ` (${resendCountdown}s)` : ""}
                      </Button>
                    </div>
                  )}

                  {isEmailVerified && verifiedUser && (
                    <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">Verified email</p>
                        <p className="text-foreground">{verifiedUser.email}</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={handleResetVerification}>
                        Use a different email
                      </Button>
                    </div>
                  )}
                </form>

                {isEmailVerified ? (
                  <form onSubmit={handleSignUp} className="flex flex-col gap-6">
                    <div className="grid gap-3">
                      <Label>I am signing up as:</Label>
                      <RadioGroup value={role} onValueChange={(value) => setRole(value as "victim" | "helper")}>
                        <div className="flex items-center space-x-2 p-3 rounded-xl border border-border hover:bg-accent/5 transition-colors">
                          <RadioGroupItem value="victim" id="victim" />
                          <Label htmlFor="victim" className="flex items-center gap-2 cursor-pointer flex-1">
                            <UserIcon className="h-4 w-4 text-primary" />
                            <div>
                              <div className="font-medium">Claimant</div>
                              <div className="text-xs text-muted-foreground">I need help with my complaint</div>
                            </div>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2 p-3 rounded-xl border border-border hover:bg-accent/5 transition-colors">
                          <RadioGroupItem value="helper" id="helper" />
                          <Label htmlFor="helper" className="flex items-center gap-2 cursor-pointer flex-1">
                            <Heart className="h-4 w-4 text-accent" />
                            <div>
                              <div className="font-medium">Helper</div>
                              <div className="text-xs text-muted-foreground">I{"'"}m helping someone with their case</div>
                            </div>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="password">Password (minimum 8 characters)</Label>
                      <Input
                        id="password"
                        type="password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Data Processing Consent (PDPA)</Label>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>We will process your personal data for:</p>
                        <ul className="space-y-1 ml-4">
                          {pdpaConsentPurposes.map((purpose, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <span className="text-xs mt-1">•</span>
                              <span>{purpose}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="flex items-start space-x-2">
                      <Checkbox
                        id="terms"
                        checked={agreedToTerms}
                        onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
                      />
                      <Label htmlFor="terms" className="text-sm leading-relaxed">
                        I agree to the{" "}
                        <Link href="/terms" className="underline underline-offset-4">
                          Terms of Service
                        </Link>{" "}
                        and acknowledge the{" "}
                        <Link href="/privacy" className="underline underline-offset-4">
                          Privacy Policy
                        </Link>
                      </Label>
                    </div>

                    <p className="text-xs text-muted-foreground">Your info is encrypted and secure.</p>

                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" className="w-full rounded-full" disabled={isLoading || !agreedToTerms}>
                      {isLoading ? "Creating account..." : "Create My Account"}
                    </Button>

                    <div className="mt-2 text-center text-sm">
                      Already have an account?{" "}
                      <Link href="/auth/login" className="underline underline-offset-4">
                        Sign in
                      </Link>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-xl border border-dashed border-muted-foreground/40 p-4 text-sm text-muted-foreground">
                    <p>Step 2 will unlock automatically once you confirm your email.</p>
                    <p className="mt-2">Open the link we just emailed you, then return here to finish your profile.</p>
                    {checkingVerification && <p className="mt-2 text-xs">Waiting for confirmation...</p>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
