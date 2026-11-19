'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { Menu } from 'lucide-react'
import { useState } from 'react'
import { marketingNavLinks } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { AccountButton } from '@/components/harbor/account-button'
import { ModeSwitcher } from '@/components/harbor/mode-switcher'
import { START_EVALUATION, STORY_ANCHOR } from '@/lib/harbor/cta'
import { cn } from '@/lib/utils'

export function PublicHeader() {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Signed-in people who come back to the public pages get "My cases" instead of "Sign in" (finding E2).
  const { isSignedIn } = useAuth()
  const account = isSignedIn ? { href: '/app', label: 'My cases' } : { href: '/sign-in', label: 'Sign in' }

  const linkClass = (href: string) =>
    cn(
      'inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-[var(--harbor-text-nav)] hover:bg-accent hover:text-foreground',
      pathname === href && 'bg-accent text-foreground',
    )

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="gb-container flex min-h-16 items-center gap-2">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2 rounded-full pr-2 font-semibold">
          <Image
            src="/assets/harbor/lumi-72.webp"
            alt=""
            width={36}
            height={36}
            className="size-9 object-contain"
          />
          {/* Brief W1 §A2: on narrow phones the name gives way to the start button; screen readers still hear it. */}
          <span className="sr-only min-[420px]:not-sr-only">GuideBuoy AI</span>
        </Link>

        <nav aria-label="Primary navigation" className="ml-auto hidden items-center lg:flex">
          {marketingNavLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={linkClass(item.href)}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-2">
          {/* A signed-in phone header has the account button too; the display settings move into the menu to make room. */}
          <div className={cn('shrink-0', isSignedIn && 'hidden sm:block')}>
            <ModeSwitcher />
          </div>
          <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
            <Link href={account.href}>{account.label}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={STORY_ANCHOR}>{START_EVALUATION}</Link>
          </Button>
          <AccountButton />
          <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu">
                <Menu aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent className="!left-auto !right-0 !top-0 h-dvh w-[min(90vw,24rem)] max-w-none !translate-x-0 !translate-y-0 rounded-none border-y-0 border-r-0 p-6 pt-16">
              <DialogTitle>Menu</DialogTitle>
              <DialogDescription className="sr-only">GuideBuoy AI pages and account links</DialogDescription>
              <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
                <Link href="/" className={linkClass('/')} onClick={() => setDrawerOpen(false)}>
                  Home
                </Link>
                {marketingNavLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={linkClass(item.href)}
                    aria-current={pathname === item.href ? 'page' : undefined}
                    onClick={() => setDrawerOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-6 border-t pt-6">
                <div className="grid gap-2">
                  <Button asChild className="w-full" onClick={() => setDrawerOpen(false)}>
                    <Link href={STORY_ANCHOR}>{START_EVALUATION}</Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full" onClick={() => setDrawerOpen(false)}>
                    <Link href={account.href}>{account.label}</Link>
                  </Button>
                </div>
                {isSignedIn && (
                  <div className="mt-4 flex items-center justify-between gap-2 sm:hidden">
                    <span className="text-sm font-medium">Display and sensory settings</span>
                    <ModeSwitcher />
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  )
}
