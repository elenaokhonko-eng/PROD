"use client"

import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface NomineeUpgradeModalProps {
  isOpen: boolean
  onClose: () => void
  onUpgrade: () => void
  onContinueStandard: () => void
  claimAmount: number
}

export default function NomineeUpgradeModal({
  isOpen,
  onClose,
  onContinueStandard,
}: NomineeUpgradeModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Info className="size-5 text-primary" aria-hidden="true" />
          </span>
          <DialogTitle>Human representation is not available</DialogTitle>
          <DialogDescription className="leading-6">
            GuideBuoy does not currently offer a nominee, representative, consultation or submission service. Available automated products and their current prices are shown on the pricing page before checkout.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground" role="note">
          Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          <Button type="button" onClick={onContinueStandard}>Continue with available options</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
