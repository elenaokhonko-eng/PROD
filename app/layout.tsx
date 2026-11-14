import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Suspense } from "react"
import "./globals.css"
import { ClerkProvider } from "@clerk/nextjs"
import { CLERK_LOCALIZATION } from "@/lib/clerk-localization"
import { PageViewTracker } from "@/components/analytics/page-view-tracker"
import { QueryProvider } from "@/components/providers/query-provider"
import { RealtimeProvider } from "@/components/providers/realtime-provider"
import { ErrorBoundary } from "@/components/providers/error-boundary"
import { ThemeProvider } from "@/components/theme-provider"
import { NOINDEX } from "@/lib/seo/indexing"

export const metadata: Metadata = {
  title: {
    default: "GuideBuoy AI",
    template: "%s · GuideBuoy",
  },
  description:
    "Organise your story, supporting material and next-step information in one complaint workspace.",
  metadataBase: new URL("https://guidebuoyai.sg"),
  // No site-wide canonical: each indexable page sets its own. Pages are noindex unless they opt in (lib/seo/indexing).
  robots: NOINDEX,
  openGraph: {
    title: "Scammed in Singapore? Free scam and bank dispute evaluation · GuideBuoy",
    description:
      "Tell GuideBuoy what happened and get a free evaluation: your facts in order, how Singapore's scam rules may apply, and your next step with your bank or FIDReC.",
    url: "https://guidebuoyai.sg",
    siteName: "GuideBuoy AI",
    images: [{ url: "/assets/harbor/lumi-buoy.jpg", alt: "GuideBuoy’s avatar" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scammed in Singapore? Free scam and bank dispute evaluation · GuideBuoy",
    description: "Tell GuideBuoy what happened and get a free evaluation: your facts in order, how Singapore's scam rules may apply, and your next step with your bank or FIDReC.",
    images: ["/assets/harbor/lumi-buoy.jpg"],
  },
}

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })

const sensoryInit = `try{var m=localStorage.getItem("gb-sensory-mode");document.documentElement.dataset.sensory=m==="quiet"?"quiet":"steady"}catch(e){document.documentElement.dataset.sensory="steady"}`

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-SG" data-sensory="steady" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sensoryInit }} />
      </head>
      <body className={`font-sans ${inter.variable}`}>
        <ClerkProvider localization={CLERK_LOCALIZATION}>
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
