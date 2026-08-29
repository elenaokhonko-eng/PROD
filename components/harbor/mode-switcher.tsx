'use client'

import { useEffect, useRef, useState } from 'react'
import { Moon, Settings2, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type SensoryMode = 'steady' | 'quiet'

const STORAGE_KEY = 'gb-sensory-mode'

export function ModeSwitcher() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [grounding, setGrounding] = useState(false)
  const [sensoryMode, setSensoryMode] = useState<SensoryMode>('steady')
  const [announcement, setAnnouncement] = useState('')
  const modeBeforeGrounding = useRef<SensoryMode>('steady')

  useEffect(() => {
    const current = document.documentElement.dataset.sensory
    setSensoryMode(current === 'quiet' ? 'quiet' : 'steady')
    setMounted(true)
  }, [])

  const chooseMode = (mode: SensoryMode) => {
    setSensoryMode(mode)
    document.documentElement.dataset.sensory = mode
    localStorage.setItem(STORAGE_KEY, mode)
    setAnnouncement(`${mode === 'steady' ? 'Steady' : 'Quiet'} mode selected.`)
  }

  const beginGrounding = () => {
    modeBeforeGrounding.current = sensoryMode
    document.documentElement.dataset.sensory = 'grounding'
    setAnnouncement('A moment opened.')
    setGrounding(true)
  }

  const endGrounding = () => {
    const restoredMode = modeBeforeGrounding.current
    document.documentElement.dataset.sensory = restoredMode
    setAnnouncement(`${restoredMode === 'steady' ? 'Steady' : 'Quiet'} mode selected.`)
    setGrounding(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && grounding) endGrounding()
    setOpen(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Display and sensory settings">
          <Settings2 aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          'max-w-md',
          grounding &&
            'flex flex-col items-center justify-center bg-background sm:min-h-[32rem] max-sm:inset-0 max-sm:!left-0 max-sm:!top-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:rounded-none max-sm:border-0',
        )}
      >
        {grounding ? (
          <div className="flex max-w-lg flex-col items-center gap-8 px-6 text-center">
            <DialogTitle className="text-3xl text-harbor-primary-active">Take a moment</DialogTitle>
            <DialogDescription className="text-base leading-7">
              Breathe in slowly, pause, then breathe out. Nothing will move on until you are ready.
            </DialogDescription>
            <div className="gb-breath" aria-hidden="true" />
            <Button onClick={() => handleOpenChange(false)}>Return when ready</Button>
          </div>
        ) : (
          <div className="space-y-7">
            <div>
              <DialogTitle className="text-xl">Display and sensory settings</DialogTitle>
              <DialogDescription className="mt-2 leading-6">
                Choose the amount of decorative colour and motion that feels comfortable.
              </DialogDescription>
            </div>

            <fieldset className="space-y-3">
              <legend className="font-semibold">Sensory mode</legend>
              <div className="grid grid-cols-3 gap-2">
                {(['steady', 'quiet'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={sensoryMode === mode ? 'default' : 'outline'}
                    aria-pressed={sensoryMode === mode}
                    onClick={() => chooseMode(mode)}
                    className="px-2 capitalize"
                  >
                    {mode}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={grounding}
                  onClick={beginGrounding}
                  className="px-2"
                >
                  A moment
                </Button>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Quiet flattens decorative colour and motion. A moment pauses above this screen without changing your work.
              </p>
            </fieldset>

            <div className="space-y-3">
              <p className="font-semibold">Theme</p>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                disabled={!mounted}
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              >
                {mounted && resolvedTheme === 'dark' ? (
                  <Sun aria-hidden="true" />
                ) : (
                  <Moon aria-hidden="true" />
                )}
                Use {mounted && resolvedTheme === 'dark' ? 'light' : 'dark'} theme
              </Button>
            </div>

          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </DialogContent>
    </Dialog>
  )
}
