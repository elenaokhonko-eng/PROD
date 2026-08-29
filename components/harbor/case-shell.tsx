'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { UserButton, useUser } from '@clerk/nextjs'
import { FolderOpen, Settings } from 'lucide-react'
import { ModeSwitcher } from '@/components/harbor/mode-switcher'

export function CaseShell({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser()

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#case-content"
        className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-full bg-primary px-4 py-3 text-primary-foreground focus:translate-y-0"
      >
        Skip to case content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="gb-container flex min-h-16 items-center gap-2">
          <Link href="/app" className="flex min-h-11 items-center gap-2 rounded-full pr-2 font-semibold">
            <Image
              src="/assets/harbor/lumi-buoy.jpg"
              alt=""
              width={36}
              height={36}
              className="size-9 rounded-full object-cover"
            />
            <span className="hidden sm:inline">GuideBuoy AI</span>
          </Link>
          <nav aria-label="Case navigation" className="ml-auto flex items-center gap-1">
            <Link href="/app" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium hover:bg-accent">
              <FolderOpen className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">My cases</span>
            </Link>
            <Link href="/app/settings" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium hover:bg-accent">
              <Settings className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
            <ModeSwitcher />
            {isLoaded && isSignedIn && (
              <div className="flex size-11 items-center justify-center">
                <UserButton />
              </div>
            )}
          </nav>
        </div>
      </header>
      <div id="case-content" tabIndex={-1}>
        {children}
      </div>
    </div>
  )
}
