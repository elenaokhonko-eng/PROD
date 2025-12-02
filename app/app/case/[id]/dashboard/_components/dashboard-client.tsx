"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import Link from "next/link"
import Image from "next/image"
import { useSupabase } from "@/components/providers/supabase-provider"
import { uploadEvidence, deleteEvidence } from "@/lib/evidence-storage"
import { trackClientEvent } from "@/lib/analytics/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Progress } from "@/components/ui/progress"
import { FileText, Upload, Download, CheckCircle, AlertCircle, ArrowRight, Loader2, ImageIcon, Trash2 } from "lucide-react"

const intakeQuestions = [
  { key: "institution_name", question: "What is the name of the financial institution?", type: "text", required: true, placeholder: "e.g., DBS Bank, OCBC Bank, Great Eastern" },
  { key: "account_details", question: "What are your account/policy details?", type: "textarea", required: true, placeholder: "Account number, policy number, or other relevant identifiers" },
  { key: "incident_summary", question: "Describe what happened in detail", type: "textarea", required: true, placeholder: "Provide a chronological account of events, including dates, amounts, and key interactions" },
  { key: "financial_impact", question: "What is the financial impact?", type: "textarea", required: true, placeholder: "Describe losses, damages, or financial harm you've experienced" },
  { key: "desired_outcome", question: "What outcome are you seeking?", type: "textarea", required: true, placeholder: "e.g., Full refund of $5,000, reversal of charges, policy reinstatement" },
  { key: "previous_contact", question: "Have you contacted the institution about this issue?", type: "radio", options: ["Yes", "No"], required: true },
  { key: "contact_details", question: "Describe your previous contact attempts", type: "textarea", required: false, placeholder: "When did you contact them? What was their response?", showIf: { key: "previous_contact", value: "Yes" } },
]

interface UploadedFile {
  id: string
  filename: string
  file_type: string
  file_size: number
  category: string
}

type CaseSummary = {
  user_id?: string | null
  claim_type?: string | null
  status?: string | null
  eligibility_status?: "eligible" | "out_of_scope" | "pending" | null
  claim_amount?: number | null
  strength_score?: "low" | "medium" | "high" | null
} & Record<string, unknown>

type PaymentSummary = Record<string, unknown> | null

type DashboardClientProps = {
  caseId: string
  initialUser: User
  initialCase: CaseSummary
  initialPayment: PaymentSummary
  initialResponses: Array<{ question_key: string; response_value: string; response_type?: string }>
  initialFiles: UploadedFile[]
}

export default function DashboardClient({ caseId, initialUser, initialCase, initialPayment, initialResponses, initialFiles }: DashboardClientProps) {
  const supabase = useSupabase()
  const router = useRouter()

  const user: User | null = initialUser
  const caseData: CaseSummary | null = initialCase
  const payment = initialPayment
  const [currentIntakeStep, setCurrentIntakeStep] = useState(0)
  const [intakeResponses, setIntakeResponses] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    initialResponses.forEach((r) => { map[r.question_key] = r.response_value })
    return map
  })
  const [isSavingIntake, setIsSavingIntake] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(initialFiles)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [isDragging, setIsDragging] = useState(false)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false)
  const [checkoutStatus, setCheckoutStatus] = useState<"success" | "cancel" | null>(null)
  const [hasUnlockedCase, setHasUnlockedCase] = useState<boolean>(Boolean(payment))
  const [isGeneratingPack, setIsGeneratingPack] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [packDownloadUrl, setPackDownloadUrl] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.localStorage.getItem(`gb_case_unlocked_${caseId}`)
    if (stored === "true") {
      setHasUnlockedCase(true)
    }
  }, [caseId])

  const intakeComplete = useMemo(() => intakeQuestions.every((q) => !q.required || intakeResponses[q.key]), [intakeResponses])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  const completeIntake = async () => {
    setIsSavingIntake(true)
    try {
      const responsePromises = Object.entries(intakeResponses).map(([key, value]) =>
        supabase.from("case_responses").upsert(
          {
            case_id: caseId,
            question_key: key,
            response_value: value,
            response_type: intakeQuestions.find((q) => q.key === key)?.type || "text",
          },
          { onConflict: "case_id,question_key" },
        ),
      )
      await Promise.all(responsePromises)
      await supabase.from("cases").update({ status: "evidence", updated_at: new Date().toISOString() }).eq("id", caseId)
      await trackClientEvent({
        eventName: "intake_complete",
        userId: caseData?.user_id ?? null,
        eventData: { case_id: caseId },
        pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      })
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error completing intake:", error)
    } finally {
      setIsSavingIntake(false)
    }
  }

useEffect(() => {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  const status = params.get("checkout")
  if (status === "success" || status === "cancel") {
    setCheckoutStatus(status)
    if (status === "success") {
      setHasUnlockedCase(true)
      window.localStorage.setItem(`gb_case_unlocked_${caseId}`, "true")
    }
    window.history.replaceState({}, "", window.location.pathname)
  }
}, [caseId])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (hasUnlockedCase) {
      window.localStorage.setItem(`gb_case_unlocked_${caseId}`, "true")
    }
  }, [hasUnlockedCase, caseId])

  useEffect(() => {
    if (checkoutStatus === "success") {
      const timeout = setTimeout(() => setCheckoutStatus(null), 8000)
      return () => clearTimeout(timeout)
    }
    return
  }, [checkoutStatus])

  const handleIntakeNext = async () => {
    const currentQuestion = intakeQuestions[currentIntakeStep]
    if (currentQuestion.required && !intakeResponses[currentQuestion.key]) return
    if (currentIntakeStep < intakeQuestions.length - 1) {
      setCurrentIntakeStep((s) => s + 1)
    } else {
      await completeIntake()
    }
  }

  const handleIntakeBack = () => {
    if (currentIntakeStep > 0) setCurrentIntakeStep((s) => s - 1)
  }

  const handleFileUpload = useCallback(
    async (files: FileList) => {
      if (!hasUnlockedCase || files.length === 0 || !user) return
      setIsUploading(true)
      setUploadErrors([])
      const errors: string[] = []
      let uploadedCount = 0
      let totalBytes = 0
      try {
        const fileArray = Array.from(files)
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i]
          const fileId = `${Date.now()}-${i}`
          if (file.size > 10 * 1024 * 1024) { errors.push(`${file.name} is too large (max 10MB)`); continue }
          const allowedTypes = [
            "application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg","image/png","image/gif","text/plain","text/csv","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ]
          if (!allowedTypes.includes(file.type)) { errors.push(`${file.name} has an unsupported format`); continue }
          setUploadProgress((prev) => ({ ...prev, [fileId]: 0 }))
          try {
            const progressInterval = setInterval(() => {
              setUploadProgress((prev) => {
                const current = prev[fileId] || 0
                if (current >= 90) { clearInterval(progressInterval); return prev }
                return { ...prev, [fileId]: current + 10 }
              })
            }, 100)
            const uploadedFile = await uploadEvidence(caseId, user.id, file, "evidence", `Uploaded: ${file.name}`)
            clearInterval(progressInterval)
            setUploadProgress((prev) => ({ ...prev, [fileId]: 100 }))
            uploadedCount++
            totalBytes += file.size
            setUploadedFiles((prev) => [...prev, { id: uploadedFile.id, filename: uploadedFile.filename, file_type: uploadedFile.file_type, file_size: uploadedFile.file_size, category: uploadedFile.category }])
            setTimeout(() => {
              setUploadProgress((prev) => { const np = { ...prev }; delete np[fileId]; return np })
            }, 1000)
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Upload error:", error)
            errors.push(`Failed to upload ${file.name}`)
            setUploadProgress((prev) => { const np = { ...prev }; delete np[fileId]; return np })
          }
        }
        if (errors.length > 0) setUploadErrors(errors)
        if (uploadedCount > 0) {
          await trackClientEvent({
            eventName: "documents_uploaded",
            userId: user.id,
            eventData: {
              case_id: caseId,
              files_uploaded: uploadedCount,
              total_bytes: totalBytes,
            },
          })
        }
      } finally {
        setIsUploading(false)
      }
    },
    [hasUnlockedCase, user, caseId],
  )

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (!user) return
      try {
        await deleteEvidence(fileId, user.id)
        setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId))
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Delete error:", error)
        // eslint-disable-next-line no-alert
        alert("Failed to delete file. Please try again.")
      }
    },
    [user],
  )

  const handleCheckout = async () => {
    try {
      setIsCreatingCheckout(true)
      const res = await fetch("/api/payments/create-checkout-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to start checkout")
      if (data.url) window.location.href = data.url as string
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Checkout error:", err)
      // eslint-disable-next-line no-alert
      alert("Unable to start checkout. Please try again.")
    } finally {
      setIsCreatingCheckout(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith("image/")) return <ImageIcon className="h-5 w-5 text-blue-600" />
    if (fileType.includes("pdf")) return <FileText className="h-5 w-5 text-red-600" />
    if (fileType.includes("word") || fileType.includes("document")) return <FileText className="h-5 w-5 text-blue-700" />
    if (fileType.includes("excel") || fileType.includes("spreadsheet")) return <FileText className="h-5 w-5 text-green-600" />
    return <FileText className="h-5 w-5 text-muted-foreground" />
  }

  const handleGenerateCasePack = useCallback(async () => {
    if (!caseId) return

    setIsGeneratingPack(true)
    setGenerationError(null)
    setPackDownloadUrl(null)

    // eslint-disable-next-line no-console
    console.log("Initiating case pack generation for case:", caseId)

    try {
      const response = await fetch(`/api/cases/${caseId}/generate-pack`, {
        method: "POST",
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`)
      }

      if (!result.downloadUrl) {
        throw new Error("API did not return a download URL.")
      }

      // eslint-disable-next-line no-console
      console.log("Case pack generated. Download URL:", result.downloadUrl)
      setPackDownloadUrl(result.downloadUrl)

      await trackClientEvent({
        eventName: "report_generated",
        userId: initialUser.id,
        eventData: {
          case_id: caseId,
          files_uploaded: uploadedFiles.length,
        },
      })
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to generate case pack:", error)
      const message = error instanceof Error ? error.message : String(error)
      setGenerationError(`Failed to generate case pack: ${message}`)
    } finally {
      setIsGeneratingPack(false)
    }
  }, [caseId, initialUser.id, uploadedFiles.length])

  const currentQuestion = intakeQuestions[currentIntakeStep]
  const intakeProgress = ((currentIntakeStep + 1) / intakeQuestions.length) * 100

  const supportedCaseTypes = new Set(["fidrec_scam", "fidrec_fraud", "phishing_scam"])

  if (!caseData?.claim_type || !supportedCaseTypes.has(caseData.claim_type)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w/full rounded-xl">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-center">Case Type Not Supported</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">This MVP currently only supports selected scam and fraud cases. Other case types will be available soon.</p>
            <Button onClick={() => router.push("/")} className="w-full rounded-full">Return Home</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">GB</span>
              </div>
              <span className="font-semibold text-lg">GuideBuoy AI</span>
            </Link>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="rounded-full">
                {caseData?.claim_type?.replace("_", " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
              </Badge>
              {hasUnlockedCase && (
                <Badge variant="default" className="bg-accent text-accent-foreground rounded-full">Premium Access</Badge>
              )}
              {user && (
                <>
                  <span className="text-sm text-muted-foreground hidden sm:inline">{user.email}</span>
                  <Button variant="outline" size="sm" onClick={handleSignOut} className="rounded-full bg-transparent">Sign Out</Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Disclaimer Banner */}
      <div className="bg-accent/10 border-b border-accent/20 py-2">
        <div className="container mx-auto px-4">
          <p className="text-sm text-foreground text-center"><strong>Disclaimer:</strong> GuideBuoy AI is an AI assistant, not a law firm. We provide guidance, not legal advice.</p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {checkoutStatus === "success" && (
            <div className="rounded-xl border border-emerald-400/50 bg-emerald-500/10 p-4 flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-700">Payment confirmed</p>
                <p className="text-sm text-emerald-700/80 dark:text-emerald-200/80">
                  Thank you for your purchase! Your case pack is unlocked—continue building your claim below.
                </p>
              </div>
            </div>
          )}
          {checkoutStatus === "cancel" && (
            <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-700">Checkout cancelled</p>
                <p className="text-sm text-amber-700/80 dark:text-amber-200/80">
                  Your payment wasn&apos;t completed. You can retry whenever you&apos;re ready.
                </p>
              </div>
            </div>
          )}
          <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20 rounded-xl">
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <Image src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/GuideBuoy%20AI%20Lumi.jpg-aoPz1T5V8wp6KMHOH8WvFjPT811qv1.jpeg" alt="Lumi" width={60} height={60} className="rounded-full" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-xl mb-2 text-balance">
                    {!hasUnlockedCase
                      ? "Ready to unlock your case pack?"
                      : !intakeComplete
                        ? <>Let{"'"}s build your case story</>
                        : uploadedFiles.length === 0
                          ? "Upload your evidence"
                          : "Your case is ready!"}
                  </CardTitle>
                  <p className="text-muted-foreground mb-4 text-pretty">
                    {!hasUnlockedCase
                      ? "Get professional documents and step-by-step guidance for S$99."
                      : !intakeComplete
                        ? "Answer a few questions to build a strong foundation for your submission."
                        : uploadedFiles.length === 0
                          ? "Add supporting documents to strengthen your case."
                          : "Review your information and generate your professional case pack."}
                  </p>
                  {!hasUnlockedCase && (
                    <Button size="lg" className="rounded-full" onClick={handleCheckout} disabled={isCreatingCheckout}>
                      {isCreatingCheckout ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Redirecting to Checkout...</>) : (<>Unlock Case Pack - S$99</>)}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Case Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between"><span className="text-muted-foreground">Case Type:</span><span className="font-medium">{caseData?.claim_type?.replace("_", " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status:</span><Badge variant="secondary" className="rounded-full">{caseData?.status}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Eligibility:</span><Badge variant={caseData?.eligibility_status === "eligible" ? "default" : "secondary"} className="rounded-full bg-accent text-accent-foreground">{caseData?.eligibility_status}</Badge></div>
                {caseData?.claim_amount && (<div className="flex justify-between"><span className="text-muted-foreground">Amount:</span><span className="font-medium">S${caseData.claim_amount.toLocaleString()}</span></div>)}
                {caseData?.strength_score && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Strength:</span>
                    <Badge variant={caseData.strength_score === "high" ? "default" : caseData.strength_score === "medium" ? "secondary" : "destructive"} className="rounded-full">{caseData.strength_score}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5" />Progress Tracker</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Case Intake:</span><Badge variant={intakeComplete ? "default" : "secondary"} className="rounded-full">{intakeComplete ? "Complete" : "In Progress"}</Badge></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Evidence Upload:</span><Badge variant={uploadedFiles.length > 0 ? "default" : "secondary"} className="rounded-full bg-accent text-accent-foreground">{uploadedFiles.length} files</Badge></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Documents:</span><Badge variant="secondary" className="rounded-full">Ready to Generate</Badge></div>
              </CardContent>
            </Card>
          </div>

          {hasUnlockedCase && !intakeComplete && (
            <Card className="rounded-xl border-primary/20">
              <CardHeader>
                <CardTitle>Guided Case Intake</CardTitle>
                <div className="flex justify-between items-center mt-2"><span className="text-sm text-muted-foreground">Question {currentIntakeStep + 1} of {intakeQuestions.length}</span><Progress value={intakeProgress} className="h-2 w-1/2" /></div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-lg font-semibold mb-3 block">{currentQuestion.question}</Label>
                  {currentQuestion.required && (<Badge variant="secondary" className="mb-3">Required</Badge>)}
                  {currentQuestion.type === "text" && (
                    <Input type="text" value={intakeResponses[currentQuestion.key] || ""} onChange={(e) => setIntakeResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))} placeholder={currentQuestion.placeholder} className="mt-2" />
                  )}
                  {currentQuestion.type === "textarea" && (
                    <Textarea value={intakeResponses[currentQuestion.key] || ""} onChange={(e) => setIntakeResponses((prev) => ({ ...prev, [currentQuestion.key]: e.target.value }))} placeholder={currentQuestion.placeholder} rows={6} className="mt-2" />
                  )}
                  {currentQuestion.type === "radio" && (
                    <RadioGroup value={intakeResponses[currentQuestion.key] || ""} onValueChange={(value) => setIntakeResponses((prev) => ({ ...prev, [currentQuestion.key]: value }))}>
                      {currentQuestion.options?.map((option) => (
                        <div key={option} className="flex items-center space-x-2"><RadioGroupItem value={option} id={option} /><Label htmlFor={option}>{option}</Label></div>
                      ))}
                    </RadioGroup>
                  )}
                </div>
                <div className="flex justify-between pt-4">
                  <Button variant="outline" onClick={handleIntakeBack} disabled={currentIntakeStep === 0} className="rounded-full bg-transparent">Back</Button>
                  <Button onClick={handleIntakeNext} disabled={(currentQuestion.required && !intakeResponses[currentQuestion.key]) || isSavingIntake} className="rounded-full">
                    {isSavingIntake ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>) : currentIntakeStep === intakeQuestions.length - 1 ? ("Complete Intake") : (<>Next<ArrowRight className="h-4 w-4 ml-2" /></>)}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {hasUnlockedCase && intakeComplete && (
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Upload Evidence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${isDragging ? "border-primary bg-primary/10 scale-[1.02] shadow-lg" : "border-border hover:border-primary/50 hover:bg-accent/5"}`} onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e.dataTransfer.files) }} onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}>
                  <div className={`transition-transform duration-200 ${isDragging ? "scale-110" : "scale-100"}`}>
                    <Upload className={`h-12 w-12 mx-auto mb-4 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <p className="text-lg font-medium mb-2">{isDragging ? "Drop your files here" : "Drop files here or click to upload"}</p>
                  <p className="text-sm text-muted-foreground mb-4">PDF, images, Word docs, Excel files. Max 10MB per file.</p>
                  <Input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt,.csv,.xls,.xlsx" onChange={(e) => e.target.files && handleFileUpload(e.target.files)} className="hidden" id="file-upload" disabled={isUploading} />
                  <Label htmlFor="file-upload">
                    <Button variant="outline" disabled={isUploading} className="rounded-full bg-transparent" asChild>
                      <span>{isUploading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>) : (<><Upload className="h-4 w-4 mr-2" />Choose Files</>)}</span>
                    </Button>
                  </Label>
                  {uploadErrors.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {uploadErrors.map((error, index) => (
                        <div key={index} className="flex items-center gap-2 text-destructive bg-destructive/10 p-3 rounded-lg">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          <p className="text-sm text-left">{error}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {Object.entries(uploadProgress).length > 0 && (
                    <div className="mt-4 space-y-3">
                      {Object.entries(uploadProgress).map(([fileId, progress]) => (
                        <div key={fileId} className="bg-accent/50 p-3 rounded-lg">
                          <div className="flex items-center justify-between mb-2"><p className="text-sm font-medium">Uploading...</p><p className="text-sm text-muted-foreground">{progress}%</p></div>
                          <Progress value={progress} className="h-2" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between"><Label className="text-base font-semibold">Uploaded Files</Label><Badge variant="secondary" className="rounded-full">{uploadedFiles.length} {uploadedFiles.length === 1 ? "file" : "files"}</Badge></div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {uploadedFiles.map((file) => (
                        <div key={file.id} className="flex items-center justify-between p-4 border border-border rounded-xl bg-card hover:bg-accent/5 transition-colors group">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex-shrink-0">{getFileIcon(file.file_type)}</div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{file.filename}</p>
                              <p className="text-xs text-muted-foreground">{formatFileSize(file.file_size)}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteFile(file.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {hasUnlockedCase && intakeComplete && uploadedFiles.length > 0 && (
            <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/30 rounded-xl">
              <CardContent className="pt-6">
                <div className="text-center">
                  <h3 className="font-semibold text-xl mb-2">Ready to Generate Your Case Pack!</h3>
                  <p className="text-muted-foreground mb-6">You{"'"}ve completed intake and uploaded {uploadedFiles.length} pieces of evidence. Generate your professional documents now.</p>
                  <Button
                    size="lg"
                    className="rounded-full"
                    onClick={handleGenerateCasePack}
                    disabled={isGeneratingPack || !hasUnlockedCase || !intakeComplete || uploadedFiles.length === 0}
                  >
                    {isGeneratingPack ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Download className="h-5 w-5 mr-2" />
                        Generate & Download Case Pack
                      </>
                    )}
                  </Button>
                  {isGeneratingPack && (
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                      Generating your case pack, please wait...
                    </p>
                  )}
                  {generationError && (
                    <p className="mt-2 text-center text-sm text-destructive">{generationError}</p>
                  )}
                  {packDownloadUrl && !isGeneratingPack && (
                    <div className="mt-4 text-center">
                      <p className="text-sm text-green-600">Case pack generated successfully!</p>
                      <a
                        href={packDownloadUrl}
                        download={`GuideBuoy_Case_${caseId || "pack"}.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-2 text-blue-600 hover:underline"
                        onClick={() =>
                          trackClientEvent({
                            eventName: "report_downloaded",
                            userId: initialUser.id,
                            eventData: {
                              case_id: caseId,
                              download_url: packDownloadUrl,
                            },
                          })
                        }
                      >
                        Click here to Download PDF
                      </a>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}















