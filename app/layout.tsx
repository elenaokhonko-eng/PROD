import type React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { Inter } from "next/font/google"
import { Suspense } from "react"
import "./globals.css"
import { SupabaseProvider } from "@/components/providers/supabase-provider"
import { PageViewTracker } from "@/components/analytics/page-view-tracker"

export const metadata: Metadata = {
  title: "GuideBuoy AI - Singapore's Complaint Helper",
  description:
    "Navigate scams and complaints with confidence. Lumi organises one report you can reuse with the Police, FIDReC, and national partners.",
  metadataBase: new URL("https://guidebuoyai.sg"),
  openGraph: {
    title: "GuideBuoy AI - Singapore's Complaint Helper",
    description:
      "Navigate scams and complaints with confidence. Lumi organises one report you can reuse with the Police, FIDReC, and national partners.",
    url: "https://guidebuoyai.sg",
    siteName: "GuideBuoy AI",
    images: [
      {
        url: "/placeholder-logo.png",
        width: 1200,
        height: 630,
        alt: "GuideBuoy AI",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "GuideBuoy AI - Singapore's Complaint Helper",
    description:
      "Navigate scams and complaints with confidence. Lumi organises one report you can reuse with the Police, FIDReC, and national partners.",
    images: ["/placeholder-logo.png"],
  },
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
          <Suspense fallback={null}>
            <PageViewTracker />
            {children}
          </Suspense>
          <footer className="border-t border-border/50 bg-card/50 mt-12">
            <div className="container mx-auto px-4 py-10 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-primary-foreground font-bold text-sm">GB</span>
                  </div>
                  <div>
                    <p className="font-semibold">GuideBuoy AI</p>
                    <p className="text-sm text-muted-foreground">SG Complaint Helper</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Connect with us:</span>
                  <Link href="https://www.linkedin.com" className="hover:text-foreground">LinkedIn</Link>
                  <Link href="https://www.instagram.com" className="hover:text-foreground">Instagram</Link>
                  <Link href="https://www.facebook.com" className="hover:text-foreground">Facebook</Link>
                  <Link href="https://www.youtube.com" className="hover:text-foreground">YouTube</Link>
                  <Link href="https://www.twitter.com" className="hover:text-foreground">X</Link>
                </div>
              </div>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm text-muted-foreground">
                <p>GuideBuoy AI SG Pte Ltd © 2025</p>
                <div className="flex flex-wrap gap-4">
                  <Link href="/terms" className="hover:text-foreground">Terms of Use</Link>
                  <Link href="/privacy" className="hover:text-foreground">Privacy &amp; Cookies Policy</Link>
                  <Link href="mailto:security@guidebuoyai.sg" className="hover:text-foreground">Report Vulnerability</Link>
                </div>
              </div>
            </div>
          </footer>
        </SupabaseProvider>
      </body>
    </html>
  )
}
