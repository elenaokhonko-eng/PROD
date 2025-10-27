"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { User as UserIcon, Bell, Shield, Eye, Download, Trash2 } from "lucide-react"
import Link from "next/link"
import { ReferralWidget } from "@/components/referral-widget"
import { useSupabase } from "@/components/providers/supabase-provider"

type Profile = {
  full_name?: string | null
  phone_number?: string | null
} & Record<string, unknown>

type SettingsClientProps = {
  initialUser: User
  initialProfile: Profile | null
}

export default function SettingsClient({ initialUser, initialProfile }: SettingsClientProps) {
  const router = useRouter()
  const supabase = useSupabase()

  const [user] = useState<User | null>(initialUser)
  const [profile] = useState<Profile | null>(initialProfile)
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
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
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email,
        updated_at: new Date().toISOString(),
      })
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

  const handleDeleteAccount = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      return
    }
    try {
      const res = await fetch("/api/privacy/delete-request", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Delete request failed")
      // eslint-disable-next-line no-alert
      alert("Your data has been anonymized for your cases. You can now sign out if you wish.")
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Delete request error:", error)
      // eslint-disable-next-line no-alert
      alert("Failed to process your deletion request. Please contact support.")
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <div className="flex items-center gap-3">
              {user && (
                <>
                  <span className="text-sm text-muted-foreground hidden sm:inline">{user.email}</span>
                  <Button variant="outline" size="sm" onClick={handleSignOut}>
                    Sign Out
                  </Button>
                </>
              )}
              <Link href="/app">
                <Button variant="outline" size="sm">
                  Back to App
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

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
                  <p className="text-sm text-muted-foreground">FIDReC timeline notifications</p>
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
                <h4 className="font-medium mb-2">PDPA Consent Log</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div>
                      <p className="text-sm font-medium">Privacy Policy v2.1</p>
                      <p className="text-xs text-muted-foreground">Accepted on signup</p>
                    </div>
                    <Badge variant="secondary">Active</Badge>
                  </div>
                </div>
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
                <h4 className="font-medium text-red-800 mb-2">Delete Account</h4>
                <p className="text-sm text-muted-foreground mb-4">Permanently delete your account and all associated data. This action cannot be undone.</p>
                <Button onClick={handleDeleteAccount} variant={showDeleteConfirm ? "destructive" : "outline"} className="w-full">
                  {showDeleteConfirm ? "Confirm Delete Account" : "Delete Account"}
                </Button>
                {showDeleteConfirm && (
                  <Button onClick={() => setShowDeleteConfirm(false)} variant="outline" size="sm" className="w-full mt-2">
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}


