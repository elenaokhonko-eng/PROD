import Link from 'next/link'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-harbor-teal-tint px-4 py-16">
      <section className="gb-card w-full max-w-xl p-8 text-center" aria-labelledby="not-found-title">
        <Compass className="mx-auto size-10 text-primary" aria-hidden="true" />
        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.16em] text-primary">404</p>
        <h1 id="not-found-title" className="mt-2 text-3xl font-semibold text-harbor-deep">Page not found</h1>
        <p className="mx-auto mt-3 max-w-md leading-7 text-muted-foreground">
          The address may be out of date, or the page may have moved.
        </p>
        <Button asChild className="mt-7 min-h-11">
          <Link href="/">Return home</Link>
        </Button>
        {/* Brief W1 §I: links to Home, How it works and FAQ. */}
        <nav aria-label="Helpful pages" className="mt-4 flex flex-wrap justify-center gap-x-5 text-sm">
          <Link href="/how-it-works" className="inline-flex min-h-11 items-center underline underline-offset-4">How it works</Link>
          <Link href="/faq" className="inline-flex min-h-11 items-center underline underline-offset-4">FAQ</Link>
        </nav>
      </section>
    </main>
  )
}
