import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { z } from "zod"
import { rateLimit, keyFrom } from "@/lib/rate-limit"
import { createServiceClient } from "@/lib/supabase/service"
import { getNextStepsForRuleEngine } from "@/lib/rules"
import { logger } from "@/lib/logger"
import type { TriageSignals } from "@/lib/rules"

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable not set.")
}

const genAI = new GoogleGenerativeAI(API_KEY)
const modelName = "models/gemini-2.5-flash"
const log = logger.withContext({ module: "router-classify", model: modelName })

const classifyRequestSchema = z.object({
  session_token: z.string().min(1, "session_token is required"),
  narrative: z.string().min(1, "narrative is required").max(20_000, "narrative is too long"),
})

const systemInstruction = `You are a triage assistant for GuideBuoy AI, a Singapore consumer dispute platform that helps scam and financial fraud victims. Analyse the user's narrative and extract structured triage signals.

Return ONE valid JSON object matching this TypeScript type EXACTLY — no additional fields, no markdown, no comments:

type TriageSignals = {
  money_lost: boolean;
  transaction_type:
    | "unauthorized_access"       // Account was accessed without the user's involvement (e.g. account takeover)
    | "deceived_into_acting"      // User was tricked into clicking a link, entering credentials, or transferring money (phishing, fake messages)
    | "voluntary_transfer"        // User willingly sent money based on false pretences (investment scam, romance scam)
    | "unknown";
  scam_type:
    | "phishing"                  // Fake link/SMS/email tricking user to enter credentials or approve a transaction
    | "investment"                // Fake investment opportunity, high returns promised
    | "romance"                   // Love scam / romance scam
    | "job"                       // Fake job offer, work-from-home scam
    | "government_impersonation"  // Impersonating SPF, IRAS, MOM, CPF, court, etc.
    | "ecommerce"                 // Online shopping or marketplace scam
    | "other"
    | "unknown";
  scam_channel:                   // For phishing only — HOW did the scam reach the user?
    | "sms"
    | "email"
    | "whatsapp_telegram_rcs"
    | "phone_call"
    | "physical_letter"
    | "website_social_media"
    | "unknown"
    | null;                       // null if scam_type is NOT phishing
  entity_impersonation: boolean | null;  // Was the scammer pretending to be a real organisation (bank, government, brand)? null if unclear
  fi_name: string | null;               // Name of the bank or financial platform involved (e.g. "DBS", "GrabPay", "Shopee"). null if not mentioned
  incident_date: string | null;         // ISO date YYYY-MM-DD of when the scam occurred. null if not mentioned
  bank_contacted: boolean | null;       // Has the user already contacted their bank about this? null if unclear
  bank_contact_date: string | null;     // ISO date when user first contacted the bank. null if not mentioned
  bank_final_reply: boolean | null;     // Has the bank issued a final reply or rejection? null if unclear
  police_report_filed: boolean | null;  // Has the user filed a police report (SPF)? null if unclear
  claim_amount_sgd: number | null;      // Approximate SGD amount lost. null if not mentioned
  summary: string;                      // One clear sentence describing what happened in plain English
  distress_signals: boolean;            // true if the narrative suggests the user is overwhelmed, elderly, in a crisis, or has not told family
};

Key rules:
- For transaction_type: "deceived_into_acting" covers phishing victims who were tricked into authorising — do NOT classify them as "voluntary_transfer" just because they clicked or transferred.
- For scam_channel: only populate this field for phishing scams. Leave null for investment, romance, job scams.
- Be conservative: only set boolean fields to true/false if the narrative is clear. Use null when genuinely uncertain.
- Return ONLY the JSON — no explanation text.`

function sanitizeText(input: string): string {
  if (!input) return input
  let out = input
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
  out = out.replace(/\b([STFG]\d{7}[A-Z])\b/gi, "[REDACTED_NRIC]")
  out = out.replace(/\b(\+?65[- ]?)?\d{4}[- ]?\d{4}\b/g, "[REDACTED_PHONE]")
  out = out.replace(/\b\d{12,16}\b/g, "[REDACTED_ACCOUNT]")
  return out
}

/** Fallback signals when Gemini fails to parse. */
function fallbackSignals(summary: string): TriageSignals {
  return {
    money_lost: true,
    transaction_type: "unknown",
    scam_type: "unknown",
    scam_channel: null,
    entity_impersonation: null,
    fi_name: null,
    incident_date: null,
    bank_contacted: null,
    bank_contact_date: null,
    bank_final_reply: null,
    police_report_filed: null,
    claim_amount_sgd: null,
    summary,
    distress_signals: false,
  }
}

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/router/classify"), 20, 60_000)
    if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })

    let parsedBody
    try {
      parsedBody = classifyRequestSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { session_token: sessionToken, narrative } = parsedBody
    void sessionToken

    const sanitizedNarrative = sanitizeText(narrative)

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    })

    const userPrompt = `User narrative:
"""
${sanitizedNarrative}
"""

JSON Output:`

    log.info("Calling Gemini for triage signal extraction")
    const result = await model.generateContent(userPrompt)
    const response = result.response
    const rawText =
      response.text() ??
      response.candidates?.[0]?.content?.parts?.find((part) => "text" in part)?.text ??
      ""

    const rawPreview = rawText.length > 1000 ? `${rawText.slice(0, 1000)}...` : rawText
    log.debug("Gemini classify raw response", { preview: rawPreview, characters: rawText.length })

    let signals: TriageSignals
    try {
      signals = JSON.parse(rawText) as TriageSignals
      if (typeof signals.money_lost !== "boolean" || !signals.summary) {
        throw new Error("Parsed JSON is missing required fields.")
      }
    } catch (parseError) {
      log.warn("Classify JSON parse error — using fallback signals", {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        rawPreview: rawText.slice(0, 400),
      })
      signals = fallbackSignals("Unable to parse narrative. Please try again.")
    }

    // Persist anonymized training data
    const supabase = createServiceClient()
    const { error: insertError } = await supabase.from("anonymized_training_data").insert({
      original_case_id: null,
      anonymized_narrative: sanitizedNarrative,
      dispute_category: "Financial Dispute",
      outcome_type: null,
      anonymization_method: "regex_v2",
    })
    if (insertError) {
      log.error("Failed to persist anonymized training data", {
        error: insertError.message,
        hint: insertError.hint,
      })
    }

    // Return triage signals + legacy fields for backward compatibility
    return NextResponse.json({
      // New triage signal fields
      ...signals,
      // Legacy fields expected by older code paths
      claimType: "Financial Dispute",
      summary: signals.summary,
      keyEntities: signals.fi_name ? [signals.fi_name] : [],
      nextSteps: getNextStepsForRuleEngine(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    log.error("Classification API error", { error: message, stack })
    return NextResponse.json({ error: message || "Failed to classify case" }, { status: 500 })
  }
}
