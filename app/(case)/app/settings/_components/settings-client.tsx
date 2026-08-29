"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { User as UserIcon, Shield, Download, Trash2 } from "lucide-react"
import { ModeSwitcher } from "@/components/harbor/mode-switcher"

type Profile = {
  full_name?: string | null
  phone_number?: string | null
} & Record<string, unknown>

type SettingsClientProps = {
  initialUser: { id: string; email: string }
  initialProfile: Profile | null
}

export default function SettingsClient({ initialUser, initialProfile }: SettingsClientProps) {
  const user = initialUser
  const profile = initialProfile
  const [actionStatus, setActionStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null)
  const actionStatusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (actionStatus) actionStatusRef.current?.focus()
  }, [actionStatus])

  const handleExportData = async () => {
    setActionStatus(null)
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
      setActionStatus({ kind: "success", message: "Your data export has been downloaded." })
    } catch (err) {
      console.error("Export error:", err)
      setActionStatus({ kind: "error", message: "Your data could not be exported. Try again." })
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold mb-2">Settings</h1>
            <p className="text-muted-foreground">Manage your account and preferences</p>
          </div>

          {actionStatus && (
            <div
              ref={actionStatusRef}
              role={actionStatus.kind === "error" ? "alert" : "status"}
              tabIndex={-1}
              className={`rounded-xl border p-4 outline-none ${actionStatus.kind === "error" ? "border-harbor-error/40 bg-harbor-error-tint" : "border-harbor-success/40 bg-harbor-success-tint"}`}
            >
              {actionStatus.message}
            </div>
          )}

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
                <Input id="name" type="text" value={profile?.full_name || ""} placeholder="Not provided" disabled />
                <p className="mt-1 text-xs text-muted-foreground">Profile details are read-only here. Contact support if they need to change.</p>
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
            <CardContent className="space-y-3">
              <Button onClick={handleExportData} variant="outline" className="w-full bg-transparent">
                <Download className="h-4 w-4 mr-2" />
                Export my data
              </Button>
              <p className="text-xs text-muted-foreground">
                The export is assembled by the existing privacy service and downloaded as JSON.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Display and sensory mode</CardTitle>
            </CardHeader>
            <CardContent>
              <ModeSwitcher />
            </CardContent>
          </Card>

          <Card className="border-harbor-warning/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                Data deletion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                A deletion request must create a reviewable request and receipt before any data is changed. That reviewed workflow is not currently available.
              </p>
              <Button type="button" variant="outline" className="w-full" disabled>
                Request data deletion
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
