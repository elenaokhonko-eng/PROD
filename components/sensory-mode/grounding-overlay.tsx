"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { useSensoryMode } from "./sensory-mode-provider"

export function GroundingOverlay() {
  const { mode, resumeFromGrounding } = useSensoryMode()
  const continueRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const isOpen = mode === "grounding"

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) resumeFromGrounding()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-background" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[101] flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col items-center px-6 text-center focus:outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement && document.activeElement !== document.body
                ? document.activeElement
                : null
            continueRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocusRef.current?.focus()
            returnFocusRef.current = null
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="gb-grounding-breath mb-10 h-40 w-40 rounded-full" aria-hidden="true" />
          <DialogPrimitive.Title className="text-2xl font-semibold text-foreground">
            Take the time you need.
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-3 leading-relaxed text-muted-foreground">
            Your place is safe. Breathe in, hold, and breathe out when it feels comfortable.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close asChild>
            <Button ref={continueRef} className="mt-8 min-h-12 px-6">
              Continue when ready
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
