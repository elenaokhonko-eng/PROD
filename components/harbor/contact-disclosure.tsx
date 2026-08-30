'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function AccessibleDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-card border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-card px-4 py-3 font-semibold marker:content-none">
        {summary}
        <ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t px-4 py-4 leading-7 text-muted-foreground">{children}</div>
    </details>
  )
}

export function ContactCard() {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('submitting')
    setError(null)
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          message: form.get('message'),
        }),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Your message could not be sent.')
      }
      setStatus('sent')
      event.currentTarget.reset()
    } catch (submissionError) {
      setStatus('error')
      setError(submissionError instanceof Error ? submissionError.message : 'Your message could not be sent.')
    }
  }

  return (
    <section className="rounded-card border bg-harbor-lavender-tint p-4 sm:p-6" aria-labelledby="contact-heading">
      <h2 id="contact-heading" className="text-2xl font-semibold text-harbor-deep">
        Still have questions?
      </h2>
      <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
        Send a question to the GuideBuoy team. Do not include passwords, card details or sensitive evidence.
      </p>
      {status === 'sent' ? <p className="mt-4 text-sm text-green-700" role="status">Thanks — your message has been received.</p> : (
        <form className="mt-6 max-w-2xl space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium" htmlFor="contact-name">Name</label>
          <Input id="contact-name" name="name" required maxLength={120} disabled={status === 'submitting'} />
          <label className="block text-sm font-medium" htmlFor="contact-email">Email</label>
          <Input id="contact-email" name="email" type="email" required maxLength={254} disabled={status === 'submitting'} />
          <label className="block text-sm font-medium" htmlFor="contact-message">Message</label>
          <Textarea id="contact-message" name="message" required minLength={10} maxLength={2000} disabled={status === 'submitting'} />
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <Button type="submit" disabled={status === 'submitting'}>{status === 'submitting' ? 'Sending...' : 'Send message'}</Button>
        </form>
      )}
    </section>
  )
}
