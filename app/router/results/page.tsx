"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Loader2, CheckCircle, AlertCircle, ArrowRight, FileText, Users, BookOpen } from "lucide-react"
import Link from "next/link"
import { getSessionToken, getRouterSession, updateRouterSession } from "@/lib/router-session"

export default function ResultsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [assessment, setAssessment] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [classification, setClassification] = useState<any>(null)
  const router = useRouter()

  useEffect(() => {
    const loadResults = async () => {
      try {
        const sessionToken = getSessionToken()
        if (!sessionToken) {
          router.push("/router")
          return
        }

        const session = await getRouterSession(sessionToken)
        if (!session || !session.classification_result || !session.user_responses) {
          router.push("/router")
          return
        }
        setClassification(session.classification_result)

        // Get eligibility assessment
        const response = await fetch("/api/router/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_token: sessionToken,
            classification: session.classification_result,
            responses: session.user_responses,
          }),
        })

        if (!response.ok) {
          throw new Error("Assessment failed")
        }

        const result = await response.json()
        setAssessment(result)

        // Update session with assessment
        await updateRouterSession(sessionToken, {
          eligibility_assessment: result,
          recommended_path: result.recommended_path,
        })
      } catch (err) {
        console.error("[v0] Error loading results:", err)
        setError("Something went wrong. Please try again.")
      } finally {
        setIsLoading(false)
      }
    }

    loadResults()
  }, [router])

  const handlePathAction = (path: string) => {
    switch (path) {
      case "fidrec_eligible":
        router.push("/auth/sign-up?source=router&eligible=true")
        break
      case "waitlist":
        router.push("/waitlist?source=router")
        break
      case "self_service":
        router.push("/resources?source=router")
        break
      default:
        router.push("/")
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Analyzing your case...</p>
        </div>
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-center">Assessment Error</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">{error || "Unable to complete assessment"}</p>
            <Button onClick={() => router.push("/router")} className="w-full">
              Start Over
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const getPathConfig = (path: string) => {
    switch (path) {
      case "fidrec_eligible":
        return {
          icon: CheckCircle,
          iconColor: "text-accent",
          bgColor: "bg-accent/10",
          title: "We can move your case forward",
          description: "Your story is strong enough to keep going. Let's build your report and next steps together.",
          ctaText: "Continue to sign up",
          ctaVariant: "default" as const,
        }
      case "waitlist":
        return {
          icon: Users,
          iconColor: "text-primary",
          bgColor: "bg-primary/10",
          title: "Join Our Waitlist",
          description: "We’re lining up a specialist path for cases like yours. Join the list and we’ll notify you as soon as it’s ready.",
          ctaText: "Join Waitlist",
          ctaVariant: "default" as const,
        }
      case "self_service":
        return {
          icon: BookOpen,
          iconColor: "text-muted-foreground",
          bgColor: "bg-muted",
          title: "Self-Service Resources",
          description: "While not eligible for formal escalation, we have resources to help you resolve this yourself.",
          ctaText: "View Resources",
          ctaVariant: "default" as const,
        }
      default:
        return {
          icon: AlertCircle,
          iconColor: "text-destructive",
          bgColor: "bg-destructive/10",
          title: "We need a bit more to guide you",
          description: "We couldn’t place this yet. Add any missing details or start a fresh assessment.",
          ctaText: "Add more details",
          ctaVariant: "outline" as const,
        }
    }
  }

  const pathConfig = getPathConfig(assessment.recommended_path)
  const PathIcon = pathConfig.icon

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
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Main Result Card */}
          <Card className="shadow-lg rounded-xl">
            <CardHeader className={pathConfig.bgColor}>
              <div className="flex justify-center mb-4">
                <PathIcon className={`h-16 w-16 ${pathConfig.iconColor}`} />
              </div>
              <CardTitle className="text-center text-3xl text-balance">{pathConfig.title}</CardTitle>
              <CardDescription className="text-center text-base text-pretty">{pathConfig.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {/* Case Strength Score */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Case Strength</span>
                  <Badge
                    variant={assessment.success_probability === "high" ? "default" : "secondary"}
                    className="bg-accent text-accent-foreground"
                  >
                    {assessment.success_probability.toUpperCase()}
                  </Badge>
                </div>
                <Progress value={assessment.eligibility_score} className="h-3" />
                <p className="text-xs text-muted-foreground mt-1">{assessment.eligibility_score}/100</p>
              </div>

              {/* Key Reasoning */}
              <div>
                <h3 className="font-semibold mb-3">Assessment Summary</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  <Badge variant="secondary" className="rounded-full">
                    Complaint Type: {classification?.claimType || "Financial Dispute"}
                  </Badge>
                </div>
                <ul className="space-y-2">
                  {assessment.reasoning.map((reason: string, index: number) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Missing Information */}
              {assessment.missing_info && assessment.missing_info.length > 0 && (
                <div className="bg-destructive/10 p-4 rounded-xl">
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Missing Information
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {assessment.missing_info.map((info: string, index: number) => (
                      <li key={index} className="text-muted-foreground">
                        • {info}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next Steps */}
              <div>
                <h3 className="font-semibold mb-3">Recommended Next Steps</h3>
                <ol className="space-y-2">
                  {assessment.next_steps.map((step: string, index: number) => (
                    <li key={index} className="flex items-start gap-3 text-sm">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                        {index + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Timeline */}
              <div className="bg-muted/50 p-4 rounded-xl">
                <h3 className="font-semibold mb-2">Expected Timeline</h3>
                <p className="text-sm text-muted-foreground">{assessment.estimated_timeline}</p>
              </div>

              {/* CTA Button */}
              <Button
                onClick={() => handlePathAction(assessment.recommended_path)}
                size="lg"
                variant={pathConfig.ctaVariant}
                className="w-full rounded-full"
              >
                {pathConfig.ctaText}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Your assessment is saved. You can return anytime to continue.
              </p>
            </CardContent>
          </Card>

          {/* Alternative Options */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-lg">Other Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {assessment.recommended_path !== "fidrec_eligible" && (
                <Button
                  variant="outline"
                  className="w-full justify-between bg-transparent rounded-full"
                  onClick={() => router.push("/resources")}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Browse Self-Help Resources
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full justify-between bg-transparent rounded-full"
                onClick={() => router.push("/router")}
              >
                <span>Start a New Assessment</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

