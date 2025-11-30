import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable not set.")
}

const genAI = new GoogleGenerativeAI(API_KEY)
const modelName = "gemini-2.5-pro"

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64")
}

export async function POST(req: NextRequest) {
  console.log("Transcription request received (using @google/generative-ai)")
  try {
    const formData = await req.formData()
    const file = formData.get("audio") as File | null

    if (!file) {
      console.error("No audio file found in form data")
      return NextResponse.json({ error: "No audio file uploaded" }, { status: 400 })
    }

    console.log(`Received file: ${file.name}, size: ${file.size}, type: ${file.type}`)

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
      console.warn("Transcription result from Gemini was empty. Full response:", JSON.stringify(response, null, 2))
    } else {
      console.log("Transcription successful via Google SDK.")
    }

    return NextResponse.json({ transcription })
  } catch (error) {
    console.error("[v0] Gemini transcription error (Google SDK):", error)
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: { data?: unknown } }).response === "object"
    ) {
      const responseData = (error as { response?: { data?: unknown } }).response?.data
      if (responseData) {
        console.error("Error details:", JSON.stringify(responseData, null, 2))
      }
    }
    const message = error instanceof Error ? error.message : "Failed to transcribe audio"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
