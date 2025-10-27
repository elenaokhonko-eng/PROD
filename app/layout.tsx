import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Suspense } from "react"
import "./globals.css"
import { SupabaseProvider } from "@/components/providers/supabase-provider"

export const metadata: Metadata = {
  title: "GuideBuoy AI - Your Financial Dispute Guide",
  description:
    "Navigate financial disputes with confidence. AI-powered assistance for FIDReC cases against banks and insurers in Singapore.",
  generator: "v0.app",
}

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans ${inter.variable}`}>
        <SupabaseProvider>
          <Suspense fallback={null}>{children}</Suspense>
        </SupabaseProvider>
      </body>
    </html>
  )
}
