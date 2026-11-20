import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { PublicHeader } from '@/components/harbor/public-header'
import { PublicFooter } from '@/components/harbor/public-footer'
import { INDEX } from '@/lib/seo/indexing'
import { FunnelStep } from '@/components/analytics/funnel-step'
import { GoogleTagManager } from '@/components/analytics/google-tag-manager'
import { JsonLd } from '@/components/seo/json-ld'
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/structured-data'

export const metadata: Metadata = { robots: INDEX }

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-full bg-primary px-4 py-3 text-primary-foreground focus:translate-y-0"
      >
        Skip to main content
      </a>
      <PublicHeader />
      {children}
      <PublicFooter />
      {/* Analytics 2: where the visitor first came from, kept for this tab only. */}
      <FunnelStep />
      {/* Google campaign tracking, production only (lib/analytics/google-tag.ts). */}
      <GoogleTagManager />
      {/* Brief W1 §L5: site-wide structured data. */}
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
    </div>
  )
}
