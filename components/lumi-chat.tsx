"use client"

import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

export function LumiChat() {
  const [open, setOpen] = useState(false)
  const [feeling, setFeeling] = useState("")
  const [share, setShare] = useState("")
  const [messages, setMessages] = useState<string[]>([])
  const [responses, setResponses] = useState<string[]>([])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const entries = [feeling.trim(), share.trim()].filter(Boolean)
    if (!entries.length) return
    setMessages((prev) => [...prev, ...entries])
    setResponses((prev) => [
      ...prev,
      "I hear you. I’m here to listen. For product questions, tap Q&A to find quick answers.",
    ])
    setFeeling("")
    setShare("")
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open Lumi support"
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-24 left-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center border border-primary/40 hover:scale-105 transition"
      >
        Lumi
      </button>

      {open && (
        <Card className="fixed bottom-6 left-6 z-50 w-80 shadow-xl border border-border/70 bg-card/95 backdrop-blur">
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="relative h-12 w-12 overflow-hidden rounded-full border border-border/70">
              <Image
                src="/images/lumi-avatar.png"
                alt="Lumi avatar"
                fill
                className="object-cover"
                sizes="48px"
              />
            </div>
            <div>
              <CardTitle className="text-base">Lumi is listening</CardTitle>
              <p className="text-xs text-muted-foreground">A calm space to offload how you feel.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="space-y-1">
              <p className="text-foreground font-medium">How do you feel right now?</p>
              <p>Tell me what the incident has been like emotionally.</p>
            </div>
            <form className="space-y-2" onSubmit={handleSubmit}>
              <Textarea
                placeholder="I feel..."
                value={feeling}
                onChange={(e) => setFeeling(e.target.value)}
                className="min-h-[60px]"
              />
              <Textarea
                placeholder="What was the hardest part?"
                value={share}
                onChange={(e) => setShare(e.target.value)}
                className="min-h-[60px]"
              />
              <Button type="submit" className="w-full rounded-full">
                Share with Lumi
              </Button>
            </form>

            <div className="space-y-2">
              <p className="text-foreground font-medium">Need product answers?</p>
              <p>If you have questions about the helper, browse our Q&A page for quick answers.</p>
              <Button asChild variant="outline" className="w-full rounded-full">
                <Link href="/faq">Go to Q&A</Link>
              </Button>
            </div>

            {messages.length > 0 && (
              <div className="space-y-1">
                <p className="text-foreground font-medium">You shared:</p>
                <ul className="space-y-1 text-xs">
                  {messages.map((msg, idx) => (
                    <li key={`${msg}-${idx}`} className="rounded-lg bg-muted/60 p-2 text-muted-foreground">
                      {msg}
                    </li>
                  ))}
                </ul>
                {responses.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-foreground font-medium">Lumi:</p>
                    <ul className="space-y-1 text-xs">
                      {responses.map((msg, idx) => (
                        <li key={`${msg}-${idx}`} className="rounded-lg bg-primary/10 p-2 text-foreground">
                          {msg}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
