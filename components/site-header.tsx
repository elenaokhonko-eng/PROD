'use client'

import Link from 'next/link'
import { useUser, useClerk } from '@clerk/nextjs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { marketingNavLinks } from '@/lib/navigation'

type SiteHeaderProps = {
  badge?: string
}

export function SiteHeader({ badge }: SiteHeaderProps) {
  const { isSignedIn, isLoaded } = useUser()
  const { signOut } = useClerk()

  return (
    <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">GB</span>
            </div>
            <span className="font-semibold text-lg">GuideBuoy AI</span>
          </Link>
          <div className="flex flex-wrap items-center gap-3 md:justify-end">
            <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-muted-foreground">
              {marketingNavLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
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
