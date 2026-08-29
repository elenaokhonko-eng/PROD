"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error", error)
  }, [error])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md border-border bg-card text-center shadow-sm">
        <CardContent className="space-y-5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">GuideBuoy AI</p>
          <h1 className="text-3xl font-semibold tracking-tight">We could not load this page</h1>
          <p className="text-muted-foreground">Your information has not been changed. Please try again.</p>
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </main>
  )
}
