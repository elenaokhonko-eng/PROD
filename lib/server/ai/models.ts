// Gemini model for the router and transcription. gemini-2.0-* and gemini-2.5-* return 404 for API keys created
// after their retirement for new users; lib/server/ai/model-health.ts checks the configured ID still answers.
export function getGeminiModel(): string {
  return process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || "gemini-3.8-flash"
}
