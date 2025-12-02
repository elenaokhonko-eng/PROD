"use client"

import Image from "next/image"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { X } from "lucide-react"

export function LumiChat() {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [messages, setMessages] = useState<string[]>([])
  const [responses, setResponses] = useState<string[]>([])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const entry = note.trim()
    if (!entry.length) return
    setMessages((prev) => [...prev, entry])
    setResponses((prev) => [...prev, "I hear you. I'm here to listen and keep you steady."])
    setNote("")
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open Lumi support"
        title={open ? "Close Lumi" : "Open Lumi"}
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-24 left-6 z-50 h-16 w-16 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center border border-primary/40 hover:scale-105 transition"
      >
        <Image src="/images/lumi-avatar.png" alt="Lumi" width={48} height={48} />
      </button>

      {open && (
        <Card className="fixed bottom-6 left-6 z-50 w-80 shadow-xl border border-border/70 bg-card/95 backdrop-blur">
          <CardHeader className="flex items-start gap-3 pb-2">
            <div className="flex items-center gap-3 flex-1">
              <div className="relative h-12 w-12 overflow-hidden rounded-full border border-border/70 flex-shrink-0">
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
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Close Lumi"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="space-y-1">
              <p className="text-foreground font-medium">How do you feel right now?</p>
              <p>Tell me what the incident has been like emotionally.</p>
            </div>
            <form className="space-y-2" onSubmit={handleSubmit}>
              <Textarea
                placeholder="Share what you felt or what was hardest..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-[60px]"
              />
              <Button type="submit" className="w-full rounded-full">
                Share with Lumi
              </Button>
            </form>

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
