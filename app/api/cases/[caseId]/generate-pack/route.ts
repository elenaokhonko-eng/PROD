import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable not set.")
}

const genAI = new GoogleGenerativeAI(API_KEY)
// v1beta currently supports 1.5 Pro for JSON output; 3.0 Pro is not yet exposed here
const GEMINI_MODEL_NAME = process.env.GOOGLE_GENERATIVE_AI_MODEL ?? "models/gemini-1.5-pro-latest"
const STORAGE_BUCKET = process.env.SUPABASE_CASE_PACK_BUCKET ?? "evidence"

type FidrecCaseSummaryOutput = {
  caseTitle: string
  claimantName: string
  respondentName: string
  summaryOfDispute: string
  chronologyOfEvents: { date: string; description: string }[]
  keyArguments: string[]
  desiredResolution: string
  evidenceIndex: { fileName: string; description: string }[]
}

async function checkCaseAccess(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  caseId: string,
  userId: string,
): Promise<boolean> {
  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("owner_user_id")
    .eq("id", caseId)
    .single()

  if (caseError || !caseData) {
    console.error(`[Generate Pack] Error fetching case ${caseId}:`, caseError)
    return false
  }

  if (caseData.owner_user_id === userId) {
    return true
  }

  const { data: collaborators, error: collaboratorError } = await supabase
    .from("case_collaborators")
    .select("user_id")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .limit(1)

  if (collaboratorError) {
    console.error(`[Generate Pack] Error fetching collaborators for case ${caseId}:`, collaboratorError)
    return false
  }

  return Boolean(collaborators?.length)
}

export async function POST(_req: NextRequest, { params }: { params: { caseId: string } }) {
  const { caseId } = params
  console.log(`[Generate Pack] Request received for caseId: ${caseId}`)

  const supabase = await createSupabaseServerClient()

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error("[Generate Pack] Authentication error:", authError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = user.id
    console.log(`[Generate Pack] Authenticated user: ${userId}`)

    const hasAccess = await checkCaseAccess(supabase, caseId, userId)
    if (!hasAccess) {
      console.error(`[Generate Pack] User ${userId} forbidden access to case ${caseId}`)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const supabaseServiceRole = createServiceClient()

    const { data: caseDetails, error: caseError } = await supabaseServiceRole
      .from("cases")
      .select("*")
      .eq("id", caseId)
      .single()

    const { data: caseResponsesRaw, error: responseError } = await supabaseServiceRole
      .from("case_responses")
      .select("question_key, response_value")
      .eq("case_id", caseId)

    const { data: evidenceFilesRaw, error: evidenceError } = await supabaseServiceRole
      .from("evidence")
      .select("id, filename, description")
      .eq("case_id", caseId)

    if (caseError || responseError || evidenceError) {
      console.error("[Generate Pack] Error fetching data:", { caseError, responseError, evidenceError })
      throw new Error("Failed to fetch all required case data.")
    }

    if (!caseDetails) {
      throw new Error("Case details not found.")
    }

    console.log(
      `[Generate Pack] Fetched data for case ${caseId}: ${caseResponsesRaw?.length ?? 0} responses, ${evidenceFilesRaw?.length ?? 0} evidence files.`,
    )

    const evidenceList = evidenceFilesRaw?.map((file) => ({
      fileName: file.filename,
      description: file.description ?? "N/A",
    }))

    const intakeResponses =
      caseResponsesRaw?.map((response) => ({
        question: response.question_key,
        response: response.response_value,
      })) ?? []

    const aiInputData = {
      caseType: caseDetails.claim_type,
      caseSummary: caseDetails.case_summary,
      intakeResponses,
      evidenceList: evidenceList ?? [],
    }

    const systemPrompt = `You are an expert paralegal assistant specializing in FIDReC submissions in Singapore. Analyze the provided case data (summary, intake Q&A, evidence list) and generate a structured JSON output suitable for drafting a formal FIDReC case submission document. Focus on summarizing, structuring the timeline, identifying key arguments, and listing evidence clearly.

Return ONLY a single, valid JSON object matching the following TypeScript type. Do not include any introductory text, concluding text, explanations, or markdown formatting like \`\`\`json.

type FidrecCaseSummaryOutput = {
  caseTitle: string; // e.g., "Dispute Regarding Unauthorized Transactions on DBS Credit Card"
  claimantName: string; // Placeholder like "Claimant" if unknown
  respondentName: string; // e.g., "DBS Bank Ltd." - Extract from context if possible, otherwise placeholder "Financial Institution"
  summaryOfDispute: string; // Generate a concise 2-3 sentence summary of the core issue and amount.
  chronologyOfEvents: { date: string; description: string }[]; // Create a timeline based on intake responses and summary. Use YYYY-MM-DD where possible or descriptions like "Around October 2024".
  keyArguments: string[]; // List 3-5 bullet points outlining the claimant's main arguments or reasons for dispute.
  desiredResolution: string; // Summarize what the claimant is seeking (e.g., "Full refund of S$XXXX.XX"). Extract amount if possible.
  evidenceIndex: { fileName: string; description: string }[]; // Use the provided evidenceList directly.
};`

    const userPrompt = `Case Data:\n\`\`\`json\n${JSON.stringify(aiInputData, null, 2)}\n\`\`\`\n\nJSON Output:`

    console.log(`[Generate Pack] Calling Gemini (${GEMINI_MODEL_NAME}) for case structuring...`)
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL_NAME,
      systemInstruction: systemPrompt,
      generationConfig: { responseMimeType: "application/json" },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    })

    const result = await model.generateContent(userPrompt)
    const response = result.response

    if (!response) {
      throw new Error("AI response was empty.")
    }

    const rawJsonText = response.text()
    console.log("[Generate Pack] Raw Gemini Structure Response:", rawJsonText)

    let structuredData: FidrecCaseSummaryOutput
    try {
      structuredData = JSON.parse(rawJsonText) as FidrecCaseSummaryOutput
      if (
        !structuredData.summaryOfDispute ||
        !structuredData.chronologyOfEvents ||
        !structuredData.keyArguments ||
        !Array.isArray(structuredData.chronologyOfEvents) ||
        !Array.isArray(structuredData.keyArguments)
      ) {
        throw new Error("Parsed JSON from AI is missing required fields.")
      }
    } catch (parseError) {
      console.error("[Generate Pack] AI JSON parse error:", parseError, "Raw output:", rawJsonText)
      const message = parseError instanceof Error ? parseError.message : "Unknown parse error"
      throw new Error(`AI failed to generate valid structured data: ${message}`)
    }

    structuredData.claimantName =
      caseDetails.claimant_name ?? (user.user_metadata?.full_name as string | undefined) ?? "Claimant"
    structuredData.evidenceIndex = aiInputData.evidenceList

    console.log("[Generate Pack] Generating PDF document...")
    const pdfDoc = await PDFDocument.create()
    let page = pdfDoc.addPage()
    let { width, height } = page.getSize()
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const baseFontSize = 11
    const margin = 50
    const lineGap = 6
    let cursorY = height - margin

    const ensureSpace = (heightRequired: number) => {
      if (cursorY - heightRequired < margin) {
        page = pdfDoc.addPage()
        ;({ width, height } = page.getSize())
        cursorY = height - margin
      }
    }

    const wrapText = (text: string, fontSize: number, font = regularFont) => {
      const maxWidth = width - margin * 2
      const words = text.split(/\s+/)
      const lines: string[] = []
      let currentLine = ""

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word
        const candidateWidth = font.widthOfTextAtSize(candidate, fontSize)
        if (candidateWidth <= maxWidth) {
          currentLine = candidate
        } else {
          if (currentLine) {
            lines.push(currentLine)
          }
          currentLine = word
        }
      }

      if (currentLine) {
        lines.push(currentLine)
      }

      return lines.length > 0 ? lines : [""]
    }

    const addTextBlock = (text: string, fontSize = baseFontSize, options?: { bold?: boolean; extraGap?: number }) => {
      const { bold = false, extraGap = lineGap } = options ?? {}
      const font = bold ? boldFont : regularFont
      const lines = wrapText(text, fontSize, font)

      ensureSpace(lines.length * fontSize * 1.2)

      for (const line of lines) {
        page.drawText(line, {
          x: margin,
          y: cursorY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        })
        cursorY -= fontSize * 1.2
      }
      cursorY -= extraGap
    }

    addTextBlock(structuredData.caseTitle || "Financial Dispute Case Pack", 16, { bold: true, extraGap: 12 })
    addTextBlock(`Claimant: ${structuredData.claimantName}`)
    addTextBlock(`Respondent: ${structuredData.respondentName}`)
    addTextBlock(`Case ID (Internal): ${caseId}`)
    addTextBlock(`Date Generated: ${new Date().toLocaleDateString("en-SG")}`, baseFontSize, { extraGap: lineGap * 2 })

    addTextBlock("Summary of Dispute", 13, { bold: true, extraGap: lineGap })
    addTextBlock(structuredData.summaryOfDispute, baseFontSize, { extraGap: lineGap * 2 })

    addTextBlock("Chronology of Events", 13, { bold: true, extraGap: lineGap })
    structuredData.chronologyOfEvents.forEach((event) => {
      addTextBlock(`- ${event.date ?? "Undated"}: ${event.description}`)
    })
    cursorY -= lineGap

    addTextBlock("Key Arguments", 13, { bold: true, extraGap: lineGap })
    structuredData.keyArguments.forEach((argument) => {
      addTextBlock(`- ${argument}`)
    })
    cursorY -= lineGap

    addTextBlock("Desired Resolution", 13, { bold: true, extraGap: lineGap })
    addTextBlock(structuredData.desiredResolution, baseFontSize, { extraGap: lineGap * 2 })

    addTextBlock("Index of Submitted Evidence", 13, { bold: true, extraGap: lineGap })
    structuredData.evidenceIndex.forEach((evidence, index) => {
      const description = evidence.description && evidence.description !== "N/A" ? ` (${evidence.description})` : ""
      addTextBlock(`${index + 1}. ${evidence.fileName}${description}`)
    })

    const pdfBytes = await pdfDoc.save()
    console.log(`[Generate Pack] PDF generated (${pdfBytes.length} bytes).`)

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const storagePrefix = STORAGE_BUCKET === "evidence" ? "case-packs" : ""
    const filePathSegments = [storagePrefix, caseId, `${timestamp}_case_pack.pdf`].filter((segment) => segment.length > 0)
    const filePath = filePathSegments.join("/")
    console.log(`[Generate Pack] Uploading PDF to Supabase Storage (${STORAGE_BUCKET}) at ${filePath}...`)

    const { error: uploadError } = await supabaseServiceRole.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      })

    if (uploadError) {
      console.error("[Generate Pack] Supabase Storage upload error:", uploadError)
      throw new Error(`Failed to upload generated case pack: ${uploadError.message}`)
    }

    const expiresIn = 60 * 60
    const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, expiresIn)

    if (signedUrlError) {
      console.error("[Generate Pack] Error creating signed URL:", signedUrlError)
      throw new Error(`Failed to create download URL: ${signedUrlError.message}`)
    }

    const downloadUrl = signedUrlData?.signedUrl
    if (!downloadUrl) {
      throw new Error("Failed to retrieve signed URL after generation.")
    }

    console.log(`[Generate Pack] Signed URL generated: ${downloadUrl}`)

    return NextResponse.json({ downloadUrl })
  } catch (error) {
    console.error("[Generate Pack] Overall error:", error)
    const message = error instanceof Error ? error.message : "Failed to generate case pack."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
