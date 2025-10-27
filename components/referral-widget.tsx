"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Share2, Copy, CheckCircle, Users } from "lucide-react"

export function ReferralWidget() {
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [referralCount, setReferralCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    const fetchReferralData = async () => {
      try {
        const response = await fetch("/api/referral/generate", { method: "POST" })
        const data = await response.json()
        setReferralCode(data.referralCode)

        // Fetch referral count
        // TODO: Add API endpoint to get referral stats
        setReferralCount(0)
      } catch (error) {
        console.error("[v0] Error fetching referral data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchReferralData()
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function")
  }, [])

  const referralUrl =
    referralCode && typeof window !== "undefined" ? `${window.location.origin}/auth/sign-up?ref=${referralCode}` : ""

  const handleCopy = () => {
    if (referralUrl) {
      navigator.clipboard.writeText(referralUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = async () => {
    if (canShare && referralUrl) {
      try {
        await navigator.share({
          title: "Join GuideBuoy AI",
          text: "Get help with your financial dispute using AI-powered case management",
          url: referralUrl,
        })
      } catch (error) {
        console.error("[v0] Share error:", error)
      }
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Refer Friends</CardTitle>
            <CardDescription>Get rewards for every friend who joins</CardDescription>
          </div>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {referralCount} referred
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Your Referral Link</label>
          <div className="flex gap-2">
            <Input value={referralUrl} readOnly className="font-mono text-sm" />
            <Button onClick={handleCopy} variant="outline" size="icon" className="flex-shrink-0 bg-transparent">
              {copied ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
            {canShare && (
              <Button onClick={handleShare} variant="outline" size="icon" className="flex-shrink-0 bg-transparent">
                <Share2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg">
          <p className="text-sm font-medium mb-1">Referral Rewards:</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Your friend gets priority waitlist access</li>
            <li>• You get $10 credit when they sign up</li>
            <li>• Earn $50 when they file their first case</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
