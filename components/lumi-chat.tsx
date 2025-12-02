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
    <div className="fixed bottom-6 left-6 z-50 flex items-end gap-4">
      <button
        type="button"
        aria-label="Open Lumi support"
        title={open ? "Close Lumi" : "Open Lumi"}
        onClick={() => setOpen((prev) => !prev)}
        className="relative h-20 w-20 rounded-full bg-primary/10 shadow-xl border border-primary/30 hover:scale-105 transition transform"
      >
        <div className="absolute inset-1 rounded-full overflow-hidden bg-white shadow-inner">
          <Image
            src="/images/lumi-avatar.png"
            alt="Lumi"
            fill
            sizes="80px"
            className="object-cover"
            priority
          />
        </div>
      </button>

      {open && (
        <div className="relative">
          <div className="absolute -left-2 bottom-10 h-4 w-4 rotate-45 bg-card border-l border-b border-border/70" aria-hidden />
          <Card className="w-80 shadow-2xl border border-border/70 bg-card/95 backdrop-blur">
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
        </div>
      )}
    </div>
  )
}
