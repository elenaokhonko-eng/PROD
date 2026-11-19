// The request parameters each OpenAI model accepts. One place, used by the web app, the worker and every Edge Function,
// so switching model is a settings change (20 Nov 2026: gpt-4.1-mini, gpt-4o-mini and gpt-4.1 shut down on 14 Jan 2027;
// the replacement is gpt-6-luna).
//
// Checked against the API on 20 Nov with the staging key:
// - gpt-6 models reason before answering. `reasoning.effort` (Responses) / `reasoning_effort` (Chat Completions)
//   takes none | low | medium (default) | high | xhigh | max.
// - `temperature` is refused unless the effort is "none".
// - Chat Completions refuses `max_tokens`; the cap is `max_completion_tokens`. Responses keeps `max_output_tokens`.
// - Older models take temperature and the classic caps, and have no reasoning parameter.

export type ReasoningEffort = "none" | "low" | "medium" | "high"

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna"

export function isReasoningModel(model: string): boolean {
  return /^gpt-(5|6)/.test(model.trim().toLowerCase())
}

type Options = {
  /** How long the model may reason. Reasoning tokens count towards the output cap. */
  effort: ReasoningEffort
  /** Applied only where the model accepts it (older models, or gpt-6 with effort "none"). */
  temperature?: number
  maxOutputTokens?: number
}

/** Fields to spread into a Responses API request body. */
export function responsesParams(model: string, { effort, temperature, maxOutputTokens }: Options): Record<string, unknown> {
  const reasoning = isReasoningModel(model)
  return {
    ...(reasoning ? { reasoning: { effort } } : {}),
    ...(temperature !== undefined && (!reasoning || effort === "none") ? { temperature } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
  }
}

/** Fields to spread into a Chat Completions request body. */
export function chatParams(model: string, { effort, temperature, maxOutputTokens }: Options): Record<string, unknown> {
  const reasoning = isReasoningModel(model)
  return {
    ...(reasoning ? { reasoning_effort: effort } : {}),
    ...(temperature !== undefined && (!reasoning || effort === "none") ? { temperature } : {}),
    ...(maxOutputTokens ? { [reasoning ? "max_completion_tokens" : "max_tokens"]: maxOutputTokens } : {}),
  }
}
