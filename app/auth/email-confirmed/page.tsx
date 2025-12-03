"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useSupabase } from "@/components/providers/supabase-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, CheckCircle, AlertCircle } from "lucide-react"

export default function EmailConfirmedPage() {
  const supabase = useSupabase()
  const searchParams = useSearchParams()
  const code = searchParams.get("code")
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending")
  const [message, setMessage] = useState<string>("Confirming your email...")

  useEffect(() => {
    const confirm = async () => {
      if (!code) {
        setStatus("error")
        setMessage("Invalid or missing confirmation code.")
        return
      }
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          throw error
        }
        setStatus("success")
        setMessage("Your email is confirmed. Return to your signup tab to finish.")
      } catch (err) {
        console.error("[email-confirmed] Exchange failed:", err)
        setStatus("error")
        setMessage("We could not confirm this link. Please request a new one.")
      }
    }
    void confirm()
  }, [code, supabase])

  const Icon = status === "pending" ? Loader2 : status === "success" ? CheckCircle : AlertCircle
  const iconClass =
    status === "pending"
      ? "text-primary animate-spin"
      : status === "success"
        ? "text-emerald-600"
        : "text-destructive"

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <Icon className={`h-10 w-10 ${iconClass}`} />
          </div>
          <CardTitle>Email confirmation</CardTitle>
          <CardDescription>Keep this tab open. Finish signup in your original tab.</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground mt-3">
            If nothing updates, return to the signup page and resend the link.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

