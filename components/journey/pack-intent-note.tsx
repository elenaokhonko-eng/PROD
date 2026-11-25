'use client'

import { useEffect, useState } from 'react'
import { PACK_NAMES } from '@/components/state-machine/facts/pack-evidence'
import { type PackIntent, readPackIntent } from '@/lib/journey/pack-intent'

// PB-18 (Part B walk-through, 25 Nov): a person who chose a pack on /pricing landed on the story box, which is titled
// for the free evaluation and did not say the pack comes next. Above the story box, it now says so.
export function PackIntentNote() {
  const [intent, setIntent] = useState<PackIntent | null>(null)
  useEffect(() => setIntent(readPackIntent()), [])
  if (!intent) return null
  return (
    <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm" data-pack-intent-note={intent}>
      You chose the {PACK_NAMES[intent]}. Tell us what happened first; your case page offers the pack straight after.
    </p>
  )
}
