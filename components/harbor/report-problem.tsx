'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { buildReport, lastProblem, OPEN_REPORT_EVENT, REPORT_EMAIL, reportMailto } from '@/lib/report-problem'

// A tab on the right edge of every signed-in page opens a side panel that prepares an email to the team with the
// page, case, time and the last error shown (Elena, 7 Nov). Nothing is sent from here: the person's email app sends it.
export function ReportProblem() {
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [copied, setCopied] = useState(false)
  const [time, setTime] = useState('')

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_REPORT_EVENT, show)
    return () => window.removeEventListener(OPEN_REPORT_EVENT, show)
  }, [])

  useEffect(() => {
    if (open) {
      setTime(new Date().toLocaleString('en-SG'))
      setCopied(false)
    }
  }, [open])

  const problem = open ? lastProblem() : null
  const report = buildReport({
    description,
    pathname,
    time,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    problem,
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 z-40 flex min-h-11 -translate-y-1/2 items-center gap-2 rounded-l-lg border border-r-0 bg-background px-2 py-3 text-sm font-medium shadow-sm [writing-mode:vertical-rl] hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Bug className="size-4 rotate-90" aria-hidden="true" />
        Report a problem
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="left-auto right-0 top-0 h-full max-h-dvh w-full max-w-md translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none sm:rounded-none">
          <DialogHeader>
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription>
              Tell us what went wrong and we’ll look into it. This prepares an email to {REPORT_EMAIL} with the details
              below; nothing is sent until you press Send in your email app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="problem-description">What were you doing, and what happened?</Label>
            <Textarea id="problem-description" rows={5} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
            <p className="text-xs text-muted-foreground">Please don’t include passwords, card numbers or one-time codes.</p>
          </div>
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs">
            <p className="font-medium">Included in the report</p>
            <pre className="whitespace-pre-wrap break-words font-sans text-muted-foreground">{report.split('\nDetails:\n')[1]}</pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={reportMailto(report)}>Open email</a>
            </Button>
            <Button type="button" variant="outline" onClick={copy}>{copied ? 'Copied' : 'Copy report'}</Button>
          </div>
          <p className="text-sm text-muted-foreground">
            If your email app doesn’t open, copy the report and send it to {REPORT_EMAIL}.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
