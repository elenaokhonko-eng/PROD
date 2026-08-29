import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import Link from "next/link"

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md border-border bg-card text-center shadow-sm">
        <CardContent className="space-y-5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">GuideBuoy AI</p>
          <h1 className="text-3xl font-semibold tracking-tight">This page is not available</h1>
          <p className="text-muted-foreground">The link may be out of date, or this page may have moved.</p>
          <Button asChild><Link href="/">Return home</Link></Button>
        </CardContent>
      </Card>
    </main>
  )
}
