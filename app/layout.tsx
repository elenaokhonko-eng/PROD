import type React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { Inter } from "next/font/google"
import { Suspense } from "react"
import "./globals.css"
import { SupabaseProvider } from "@/components/providers/supabase-provider"
import { PageViewTracker } from "@/components/analytics/page-view-tracker"
import { LumiChat } from "@/components/lumi-chat"

export const metadata: Metadata = {
  title: "GuideBuoy AI - Singapore's Complaint Helper",
  description:
    "Navigate scams and complaints with confidence. Lumi organises one report you can reuse with the Police and national partners.",
  metadataBase: new URL("https://guidebuoyai.sg"),
  openGraph: {
    title: "GuideBuoy AI - Singapore's Complaint Helper",
    description:
      "Navigate scams and complaints with confidence. Lumi organises one report you can reuse with the Police and national partners.",
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
      "Navigate scams and complaints with confidence. Lumi organises one report you can reuse with the Police and national partners.",
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
          <LumiChat />
          <Link
            href="https://wa.me/6590727915"
            aria-label="Chat with GuideBuoy on WhatsApp"
            target="_blank"
            rel="noopener noreferrer"
            className="fixed bottom-6 right-6 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-6 w-6 fill-current">
              <path d="M16.02 3C9.375 3 4 8.268 4 14.797c0 2.6.86 5.01 2.32 6.966L4 29l7.426-2.3a12.2 12.2 0 0 0 4.594.905c6.644 0 12.02-5.268 12.02-11.797C28.04 8.268 22.664 3 16.02 3zm0 2.12c5.438 0 9.86 4.318 9.86 9.677 0 5.36-4.422 9.678-9.86 9.678a10.05 10.05 0 0 1-4.01-.83l-.289-.123-4.387 1.36 1.426-4.01-.188-.287a9.62 9.62 0 0 1-1.92-5.788c0-5.36 4.422-9.677 9.86-9.677zm-2.393 4.93a.69.69 0 0 0-.508.19c-.176.18-.73.71-.73 1.737 0 1.027.75 2.02.855 2.16.106.14 1.433 2.227 3.516 3.055 1.74.69 2.243.622 2.648.55.405-.074 1.303-.532 1.488-1.048.184-.516.184-.957.13-1.05-.056-.095-.202-.15-.427-.266-.224-.115-1.303-.64-1.505-.712-.202-.074-.35-.112-.508.112-.16.223-.58.712-.71.858-.132.147-.263.165-.486.05-.224-.115-.943-.347-1.798-1.105-.665-.592-1.115-1.32-1.246-1.544-.132-.223-.014-.342.1-.457.103-.102.224-.263.336-.395.113-.13.15-.223.224-.373.074-.148.037-.28-.018-.395-.056-.115-.486-1.2-.666-1.645-.18-.445-.37-.383-.507-.383z"/>
            </svg>
          </Link>
          <footer className="border-t border-border/50 bg-card/50 mt-12">
            <div className="container mx-auto px-4 py-10 space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between text-sm text-muted-foreground">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">GuideBuoy AI SG Pte Ltd © 2025</p>
                  <p>UEN: 202545875C</p>
                  <p>DID: +65 90727915 | Main: +65 66909262</p>
                  <p>Our office: 51 Goldhill Plaza #07-10/11 Singapore 308900</p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-4">
                  <Link href="/terms" className="hover:text-foreground">Terms of Use</Link>
                  <Link href="/privacy" className="hover:text-foreground">Privacy &amp; Cookies Policy</Link>
                  <Link href="mailto:security@guidebuoyai.sg" className="hover:text-foreground">Report Vulnerability</Link>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:justify-end">
                  <span className="font-medium text-foreground">Connect with us:</span>
                  <Link href="https://www.linkedin.com" className="hover:text-foreground">LinkedIn</Link>
                  <Link href="https://www.instagram.com" className="hover:text-foreground">Instagram</Link>
                  <Link href="https://www.facebook.com" className="hover:text-foreground">Facebook</Link>
                  <Link href="https://www.youtube.com" className="hover:text-foreground">YouTube</Link>
                  <Link href="https://www.twitter.com" className="hover:text-foreground">X</Link>
                  <Link href="https://wa.me/6590727915" className="hover:text-foreground">WhatsApp</Link>
                </div>
              </div>
            </div>
          </footer>
        </SupabaseProvider>
      </body>
    </html>
  )
}
