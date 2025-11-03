"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useEffect } from "react"
import type { RouterSession } from "@/lib/router-session"
import { getSessionToken, clearSessionToken, persistConvertedRouterSessionToken } from "@/lib/router-session"
import { User, Heart } from "lucide-react"
import { trackClientEvent } from "@/lib/analytics/client"

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

export default function SignUpPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"victim" | "helper">("victim")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [signupStarted, setSignupStarted] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const source = searchParams.get("source")
  const isFromRouter = source === "router"

  const pdpaConsentPurposes = [
    "Account creation and management",
    "Case processing and document generation",
    "Communication about your case progress",
    "Platform improvements and analytics",
    "Legal compliance and record keeping",
  ]

  useEffect(() => {
    if (isFromRouter) {
      trackEvent("router_conversion_start", {
        page: "signup",
        source: "router",
        timestamp: new Date().toISOString(),
      })
    }

    // Track signup start on first focus
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

  const trackEvent = async (eventName: string, eventData: Record<string, unknown>) => {
    await trackClientEvent({
      eventName,
      eventData,
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    })
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
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
          email,
          password,
          role,
          sessionToken,
          consent: consentPayload,
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
        email,
        role,
        source: source || "direct",
        timestamp: new Date().toISOString(),
      })

      await trackEvent("consent_accepted", {
        user_id: userId,
        purposes: pdpaConsentPurposes,
        timestamp: new Date().toISOString(),
      })

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

      router.push("/auth/sign-up-success")
    } catch (error: unknown) {
      console.error("[signup] Unexpected signup error:", error)
      setError(error instanceof Error ? error.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

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
                  ✓ Your case assessment is ready
                </span>
              </div>
            )}
          </div>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-2xl">Create Account</CardTitle>
              <CardDescription>
                {isFromRouter
                  ? "Create your account to continue with your case"
                  : "Get started with your financial dispute case"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSignUp}>
                <div className="flex flex-col gap-6">
                  <div className="grid gap-3">
                    <Label>I am signing up as:</Label>
                    <RadioGroup value={role} onValueChange={(value) => setRole(value as "victim" | "helper")}>
                      <div className="flex items-center space-x-2 p-3 rounded-xl border border-border hover:bg-accent/5 transition-colors">
                        <RadioGroupItem value="victim" id="victim" />
                        <Label htmlFor="victim" className="flex items-center gap-2 cursor-pointer flex-1">
                          <User className="h-4 w-4 text-primary" />
                          <div>
                            <div className="font-medium">Victim</div>
                            <div className="text-xs text-muted-foreground">I need help with my dispute</div>
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
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="m@example.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-xl"
                    />
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

                  {/* PDPA Consent */}
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
                </div>
                <div className="mt-4 text-center text-sm">
                  Already have an account?{" "}
                  <Link href="/auth/login" className="underline underline-offset-4">
                    Sign in
                  </Link>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

