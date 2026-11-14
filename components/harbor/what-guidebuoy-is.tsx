// Brief W1 §B3 (decision D4): one calm statement per public page instead of a disclaimer on every card. The full
// automated-output notice stays in the Terms and next to generated outputs inside the app.
export const WHAT_GUIDEBUOY_IS =
  'A guided way to prepare your own case. It is automated and is not legal advice; you check everything before you send it. If you would like a person to go through it with you, a 30-minute consultation is S$99.'

export function WhatGuideBuoyIs({ className }: { className?: string }) {
  return (
    <aside aria-label="What GuideBuoy is" className={['mx-auto max-w-3xl rounded-card border bg-card p-5 text-base leading-7 sm:p-6', className].filter(Boolean).join(' ')}>
      <p>
        <strong>What GuideBuoy is.</strong> {WHAT_GUIDEBUOY_IS}{' '}
        <a className="font-medium underline" href="mailto:info@guidebuoyai.sg?subject=Consultation%20booking">
          Email to book
        </a>{' '}
        <span className="text-muted-foreground">(info@guidebuoyai.sg)</span>
      </p>
    </aside>
  )
}
