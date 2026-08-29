import type { ReactNode } from 'react'
import { PublicHeader } from '@/components/harbor/public-header'
import { PublicFooter } from '@/components/harbor/public-footer'

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
    </div>
  )
}
