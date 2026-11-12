// Gemini model for the router and transcription. gemini-2.0-* and gemini-2.5-* return 404 for API keys created
// after their retirement for new users; lib/server/ai/model-health.ts checks the configured ID still answers.
export function getGeminiModel(): string {
  return process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || "gemini-3.8-flash"
}

// Model IDs verified to answer with current keys (see the AI model health check). check-env-set fails any model
// setting outside this list or not in lower case; add an ID here only after probing it with the target keys.
export const CHECKED_MODEL_IDS = ["gemini-3.8-flash", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4o-mini-2024-07-18", "text-embedding-3-small"] as const

// App (Render) and Edge (Supabase secret) settings that name a model.
export const MODEL_SETTING_KEYS = [
  "GOOGLE_GENERATIVE_AI_MODEL",
  "OPENAI_MODEL",
  "EVIDENCE_GEMINI_MODEL",
  "CASE_EXTRACT_MODEL",
  "CASE_DECISION_MODEL",
  "SELF_SERVE_REPORT_MODEL",
] as const
