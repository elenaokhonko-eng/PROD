"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import Image from "next/image"
import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="max-w-md mx-auto text-center">
        <CardContent className="pt-8 pb-8">
          <div className="mb-6 flex justify-center">
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/GuideBuoy%20AI%20Lumi.jpg-aoPz1T5V8wp6KMHOH8WvFjPT811qv1.jpeg"
              alt="Lumi - Your AI Guide"
              width={80}
              height={80}
              className="rounded-full shadow-lg"
            />
          </div>
          <h1 className="text-2xl font-bold mb-4">Hmm, I can{"'"}t find that page</h1>
          <p className="text-muted-foreground mb-6">Let me guide you back to where you need to be.</p>
          <p className="text-sm text-muted-foreground italic mb-6">- Lumi, your AI guide</p>
          <Link href="/">
            <Button size="lg">Guide Me Home</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
