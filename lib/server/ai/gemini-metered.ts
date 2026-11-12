// Gemini calls from the web routes, capped and metered (cost-controls spec §5 B2, B5, B6). Output is capped and the
// thinking budget set per purpose (thinking tokens are billed as output); every call records one model_usage row.
import type { GenerationConfig, GenerativeModel, Part } from "@google/generative-ai"
import { geminiUsage, recordUsage } from "@/lib/server/model-usage"

/** generationConfig with the output cap and thinking budget (REST: generationConfig.thinkingConfig.thinkingBudget). */
export function cappedConfig(base: GenerationConfig, maxOutputTokens: number, thinkingBudget: number): GenerationConfig {
  // thinkingConfig is accepted by the API but not yet typed by @google/generative-ai 0.24.
  return { ...base, maxOutputTokens, thinkingConfig: { thinkingBudget } } as GenerationConfig
}

export async function meteredGenerate(
  model: GenerativeModel,
  request: string | Array<string | Part>,
  meta: { purpose: string; modelName: string; userId?: string | null },
) {
  const started = Date.now()
  try {
    const result = await model.generateContent(request)
    await recordUsage({
      caller: "web",
      purpose: meta.purpose,
      provider: "gemini",
      model: meta.modelName,
      usage: geminiUsage({ usageMetadata: result.response.usageMetadata }),
      latencyMs: Date.now() - started,
      outcome: "ok",
      userId: meta.userId ?? null,
    })
    return result
  } catch (error) {
    const status = (error as { status?: number })?.status ?? null
    await recordUsage({
      caller: "web",
      purpose: meta.purpose,
      provider: "gemini",
      model: meta.modelName,
      latencyMs: Date.now() - started,
      outcome: status === 429 ? "retry" : "error",
      httpStatus: status,
      userId: meta.userId ?? null,
    })
    throw error
  }
}
