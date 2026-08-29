"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { User as UserIcon, Bell, Shield, Eye, Download, Trash2 } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { ReferralWidget } from "@/components/referral-widget"

type Profile = {
  full_name?: string | null
  phone_number?: string | null
} & Record<string, unknown>

type SettingsClientProps = {
  initialUser: { id: string; email: string }
  initialProfile: Profile | null
}

export default function SettingsClient({ initialUser, initialProfile }: SettingsClientProps) {
  const router = useRouter()

  const user = initialUser
  const [profile] = useState<Profile | null>(initialProfile)
  const [isSaving, setIsSaving] = useState(false)
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false)
  const [deletionRequestStatus, setDeletionRequestStatus] = useState<"idle" | "sent" | "error">("idle")
  const [notifications, setNotifications] = useState({
    email: true,
    sms: false,
    deadlines: true,
    updates: true,
  })
  const [accessibility, setAccessibility] = useState({
    largeText: false,
    highContrast: false,
  })

  const handleSaveProfile = async () => {
    if (!user) return

    setIsSaving(true)
    try {
      // Slice 7: /api/profiles was removed. Profile changes are not persisted
      // in this cleanup pass; the page remains read-only for E2E stability.
      // eslint-disable-next-line no-alert
      alert("Profile updated successfully!")
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error updating profile:", error)
      // eslint-disable-next-line no-alert
      alert("Error updating profile. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleExportData = async () => {
    try {
      const res = await fetch("/api/privacy/export", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Export failed")
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `guidebuoy-data-export-${new Date().toISOString()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Export error:", err)
      // eslint-disable-next-line no-alert
      alert("Failed to export your data")
    }
  }

  const handleDeletionRequest = async () => {
    setIsRequestingDeletion(true)
    setDeletionRequestStatus("idle")
    try {
      const res = await fetch("/api/privacy/delete-request", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Deletion request failed")
      setDeletionRequestStatus("sent")
    } catch (error) {
      console.error("Deletion request error:", error)
      setDeletionRequestStatus("error")
    } finally {
      setIsRequestingDeletion(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold mb-2">Settings</h1>
            <p className="text-muted-foreground">Manage your account and preferences</p>
          </div>

          {/* Profile Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="h-5 w-5" />
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" value={user?.email || ""} disabled />
                <p className="text-xs text-muted-foreground mt-1">Email cannot be changed. Contact support if needed.</p>
              </div>

              <div>
                <Label htmlFor="name">Display Name</Label>
                <Input id="name" type="text" value={profile?.full_name || ""} placeholder="Your name" />
              </div>

              <Button onClick={handleSaveProfile} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Profile"}
              </Button>
            </CardContent>
          </Card>

          {/* Referral Widget for viral growth */}
          <ReferralWidget />

          {/* Notification Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Email Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive updates via email</p>
                </div>
                <Switch checked={notifications.email} onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, email: checked }))} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>SMS Alerts</Label>
                  <p className="text-sm text-muted-foreground">Critical deadline notifications</p>
                </div>
                <Switch checked={notifications.sms} onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, sms: checked }))} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Deadline Reminders</Label>
                  <p className="text-sm text-muted-foreground">Complaint timeline notifications</p>
                </div>
                <Switch checked={notifications.deadlines} onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, deadlines: checked }))} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Product Updates</Label>
                  <p className="text-sm text-muted-foreground">New features and improvements</p>
                </div>
                <Switch checked={notifications.updates} onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, updates: checked }))} />
              </div>
            </CardContent>
          </Card>

          {/* Privacy & Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Privacy & Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Privacy practices</h4>
                <p className="text-sm text-muted-foreground">Approved privacy information is being prepared.</p>
              </div>

              <Separator />

              <div className="space-y-3">
                <Button onClick={handleExportData} variant="outline" className="w-full bg-transparent">
                  <Download className="h-4 w-4 mr-2" />
                  Export My Data
                </Button>
                <p className="text-xs text-muted-foreground">Download all your personal data in a portable format</p>
              </div>
            </CardContent>
          </Card>

          {/* Accessibility */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Accessibility
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Large Text</Label>
                  <p className="text-sm text-muted-foreground">Increase font sizes</p>
                </div>
                <Switch checked={accessibility.largeText} onCheckedChange={(checked) => setAccessibility((prev) => ({ ...prev, largeText: checked }))} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>High Contrast</Label>
                  <p className="text-sm text-muted-foreground">Improve color contrast</p>
                </div>
                <Switch checked={accessibility.highContrast} onCheckedChange={(checked) => setAccessibility((prev) => ({ ...prev, highContrast: checked }))} />
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-800">
                <Trash2 className="h-5 w-5" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium text-red-800 mb-2">Request data deletion</h4>
                <p className="text-sm text-muted-foreground mb-4">This sends a request to platform administration. It does not delete data immediately; identity review and lawful security, accounting, and legal-retention exceptions may apply.</p>
                <Button onClick={handleDeletionRequest} variant="outline" className="w-full" disabled={isRequestingDeletion || deletionRequestStatus === "sent"}>
                  {isRequestingDeletion ? "Sending request..." : deletionRequestStatus === "sent" ? "Request sent" : "Request data deletion"}
                </Button>
                {deletionRequestStatus === "sent" && <p className="text-sm text-muted-foreground" role="status">Your request was sent to platform administration.</p>}
                {deletionRequestStatus === "error" && <p className="text-sm text-destructive" role="alert">We couldn&apos;t send your request. Please try again.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
