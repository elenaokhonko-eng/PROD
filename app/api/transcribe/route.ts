import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { getGeminiModel } from "@/lib/server/ai/models"
import { safeErrorText } from "@/lib/server/safe-error"
import { cappedConfig, meteredGenerate } from "@/lib/server/ai/gemini-metered"
import { preSignInModelPaused, GEMINI_THINKING_BUDGET, OUTPUT_CAPS } from "@/lib/server/model-usage"
import { limitResponse, MAX_AUDIO_BYTES, preSignInLimit } from "@/lib/server/usage-limits"

const UNAVAILABLE = "Voice transcription isn't available right now. Please type your story instead."

// Same model setting as the router.
const modelName = getGeminiModel()

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64")
}

export async function POST(req: NextRequest) {
  // Reachable before sign-in: limited per IP, audio capped, output capped (cost-controls B2).
  const limited = preSignInLimit(req)
  if (limited) return limitResponse(limited)
  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Transcription service is unavailable" }, { status: 503 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const formData = await req.formData()
    const file = formData.get("audio") as File | null

    if (!file) {
      console.error("No audio file found in form data")
      return NextResponse.json({ error: "No audio file uploaded" }, { status: 400 })
    }

    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "That recording is too long. Please keep voice notes to about 3 minutes, or type your story." },
        { status: 413 },
      )
    }
    if (await preSignInModelPaused()) {
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 })
    }

    const audioBuffer = await file.arrayBuffer()
    const audioBase64 = arrayBufferToBase64(audioBuffer)

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: cappedConfig({}, OUTPUT_CAPS.transcription, GEMINI_THINKING_BUDGET.transcription),
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    })

    const audioPart = {
      inlineData: {
        mimeType: file.type || "audio/webm",
        data: audioBase64,
      },
    }

    const textPart = { text: "Transcribe the following audio recording:" }

    const result = await meteredGenerate(model, [textPart, audioPart], { purpose: "transcription", modelName })
    const response = result.response
    const transcription =
      response.text() ??
      response.candidates?.[0]?.content?.parts?.find((part) => "text" in part)?.text ??
      ""

    if (!transcription) {
      console.warn("Transcription result from Gemini was empty", { finishReason: response.candidates?.[0]?.finishReason ?? null })
    }

    return NextResponse.json({ transcription })
  } catch (error) {
    console.error("[v0] Gemini transcription error (Google SDK):", safeErrorText(error))
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: { data?: unknown } }).response === "object"
    ) {
      // The provider body can echo the input; log only that there was one (hardening item 6).
      if ((error as { response?: { data?: unknown } }).response?.data) {
        console.error("Error details: provider returned an error body")
      }
    }
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 })
  }
}
