'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { marketingNavLinks } from '@/lib/navigation'
import { LumiChat } from '@/components/lumi-chat'
import { ModeSwitcher } from '@/components/sensory-mode/mode-switcher'

type SiteHeaderProps = {
  badge?: string
}

export function SiteHeader({ badge }: SiteHeaderProps) {
  const { isSignedIn, isLoaded } = useUser()
  const { signOut } = useClerk()
  const pathname = usePathname()

  return (
    <header data-site-header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Link href="/" className="flex items-center gap-2 rounded-[10px] hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">GB</span>
            </div>
            <span className="font-semibold text-lg">GuideBuoy AI</span>
          </Link>
          <div className="flex min-w-0 w-full flex-wrap items-center gap-3 md:w-auto md:flex-1 md:justify-end">
            <nav aria-label="Primary navigation" className="order-last flex min-w-0 w-full max-w-full gap-4 overflow-x-auto pb-1 text-sm font-medium text-muted-foreground md:order-none md:w-auto md:flex-wrap md:justify-end md:pb-0">
              {marketingNavLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className="whitespace-nowrap rounded px-1 py-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:font-semibold aria-[current=page]:text-primary"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <ModeSwitcher compact />
            <LumiChat />
            {badge && (
              <Badge variant="secondary" className="hidden sm:inline-flex rounded-full">
                {badge}
              </Badge>
            )}
            {isLoaded && isSignedIn ? (
              <div className="flex items-center gap-2">
                <Link href="/app/case/new">
                  <Button variant="outline" size="sm" className="rounded-full bg-transparent">
                    Dashboard
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => signOut()}
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <Link href="/sign-in">
                <Button variant="outline" size="sm" className="rounded-full bg-transparent">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
