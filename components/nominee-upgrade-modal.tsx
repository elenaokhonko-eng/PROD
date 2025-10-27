"use client"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, X, Star, Users, Calendar, Phone } from "lucide-react"

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
  onUpgrade,
  onContinueStandard,
  claimAmount,
}: NomineeUpgradeModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Upgrade Your Service</span>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Standard Service */}
          <Card className="relative">
            <CardHeader>
              <CardTitle className="text-lg">Standard Service</CardTitle>
              <div className="text-2xl font-bold">S$49</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                  <span className="text-sm">AI-generated case pack with professional documents</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                  <span className="text-sm">Case progress tracker with deadline reminders</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                  <span className="text-sm">Email and SMS reminder notifications</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                  <span className="text-sm">Self-filing guide with step-by-step instructions</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                  <span className="text-sm">30-day access to all premium features</span>
                </div>
              </div>

              <Button variant="outline" className="w-full bg-transparent" onClick={onContinueStandard}>
                Continue with Standard
              </Button>
            </CardContent>
          </Card>

          {/* Nominee Service */}
          <Card className="relative border-primary shadow-lg">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground px-4 py-1">
                <Star className="h-3 w-3 mr-1" />
                Recommended for S${claimAmount.toLocaleString()}+ claims
              </Badge>
            </div>
            <CardHeader className="pt-8">
              <CardTitle className="text-lg">FIDReC Nominee Service</CardTitle>
              <div className="text-2xl font-bold">S$500 + 10% success fee</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <Users className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                  <span className="text-sm">Qualified nominee handles your FIDReC submission</span>
                </div>
                <div className="flex items-start gap-2">
                  <Calendar className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                  <span className="text-sm">Scheduled check-ins and progress updates</span>
                </div>
                <div className="flex items-start gap-2">
                  <Phone className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                  <span className="text-sm">Priority support and direct communication</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                  <span className="text-sm">Professional bundle preparation and submission</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                  <span className="text-sm">Escalation path and mediation support</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                  <span className="text-sm">All Standard Service features included</span>
                </div>
              </div>

              <Button className="w-full" onClick={onUpgrade}>
                Upgrade to Nominee Service
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">
            <strong>Fee Structure:</strong> S$500 deposit required. 10% success fee only applies to recovered amounts.
            No additional charges if your case is unsuccessful. Full terms available during checkout.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
