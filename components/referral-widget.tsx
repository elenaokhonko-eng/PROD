"use client"

import { UserPlus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function ReferralWidget() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserPlus className="size-5" aria-hidden="true" />
          Referral sharing
        </CardTitle>
        <CardDescription>Referral links and rewards are not currently available.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" className="min-h-11" disabled>
          Referrals unavailable
        </Button>
      </CardContent>
    </Card>
  )
}
