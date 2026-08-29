import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Suspense } from "react"
import "./globals.css"
import { ClerkProvider } from "@clerk/nextjs"
import { PageViewTracker } from "@/components/analytics/page-view-tracker"
import { QueryProvider } from "@/components/providers/query-provider"
import { RealtimeProvider } from "@/components/providers/realtime-provider"
import { ErrorBoundary } from "@/components/providers/error-boundary"
import { ThemeProvider } from "@/components/theme-provider"

export const metadata: Metadata = {
  title: {
    default: "GuideBuoy AI — Singapore's Complaint Helper",
    template: "%s | GuideBuoy AI",
  },
  description:
    "Organise your story, supporting material and next-step information in one complaint workspace.",
  metadataBase: new URL("https://guidebuoyai.sg"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "GuideBuoy AI — Singapore's Complaint Helper",
    description:
      "Organise your story, supporting material and next-step information in one complaint workspace.",
    url: "https://guidebuoyai.sg",
    siteName: "GuideBuoy AI",
    images: [{ url: "/assets/harbor/lumi-buoy.jpg", alt: "Lumi, the GuideBuoy buoy guide" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GuideBuoy AI — Singapore's Complaint Helper",
    description: "Tell your story once and organise the facts for your next complaint step.",
    images: ["/assets/harbor/lumi-buoy.jpg"],
  },
}

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })

const sensoryInit = `try{var m=localStorage.getItem("gb-sensory-mode");document.documentElement.dataset.sensory=m==="quiet"?"quiet":"steady"}catch(e){document.documentElement.dataset.sensory="steady"}`

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-sensory="steady" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sensoryInit }} />
      </head>
      <body className={`font-sans ${inter.variable}`}>
        <ClerkProvider>
          <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
            <QueryProvider>
              <RealtimeProvider>
                <ErrorBoundary>
                  <Suspense fallback={null}>
                    <PageViewTracker />
                  </Suspense>
                  {children}
                </ErrorBoundary>
              </RealtimeProvider>
            </QueryProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
