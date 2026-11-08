import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { getGeminiModel } from "@/lib/server/ai/models"
import { safeErrorText } from "@/lib/server/safe-error"

// Same model setting as the router.
const modelName = getGeminiModel()

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64")
}

export async function POST(req: NextRequest) {
  console.log("Transcription request received (using @google/generative-ai)")
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

    console.log(`Received file: size ${file.size}, type ${file.type}`)

    const audioBuffer = await file.arrayBuffer()
    const audioBase64 = arrayBufferToBase64(audioBuffer)

    const model = genAI.getGenerativeModel({
      model: modelName,
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

    console.log(`Calling Gemini (${modelName}) for transcription via Google SDK...`)

    const result = await model.generateContent([textPart, audioPart])
    const response = result.response
    const transcription =
      response.text() ??
      response.candidates?.[0]?.content?.parts?.find((part) => "text" in part)?.text ??
      ""

    if (!transcription) {
      console.warn("Transcription result from Gemini was empty", { finishReason: response.candidates?.[0]?.finishReason ?? null })
    } else {
      console.log("Transcription successful via Google SDK.")
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
    const message = error instanceof Error ? error.message : "Failed to transcribe audio"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
