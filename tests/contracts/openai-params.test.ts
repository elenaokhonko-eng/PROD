import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DEFAULT_OPENAI_MODEL, chatParams, isReasoningModel, responsesParams } from '../../supabase/functions/_shared/openai-params'

// 20 Nov 2026: the OpenAI chat models in use shut down on 14 Jan 2027; gpt-6-luna replaces them. These are the rules the
// API enforced when checked with the staging key that day.

test('gpt-6 models get a reasoning effort; temperature only with effort "none"', () => {
  assert.equal(DEFAULT_OPENAI_MODEL, 'gpt-6-luna')
  assert.ok(isReasoningModel('gpt-6-luna') && isReasoningModel('gpt-6.1-terra') && !isReasoningModel('gpt-4.1-mini'))
  assert.deepEqual(responsesParams('gpt-6-luna', { effort: 'none', temperature: 0.2, maxOutputTokens: 400 }), {
    reasoning: { effort: 'none' }, temperature: 0.2, max_output_tokens: 400,
  })
  assert.deepEqual(responsesParams('gpt-6-luna', { effort: 'low', temperature: 0.2 }), { reasoning: { effort: 'low' } }, 'temperature is refused once the model reasons')
})

test('Chat Completions: gpt-6 takes max_completion_tokens and reasoning_effort; older models keep max_tokens', () => {
  assert.deepEqual(chatParams('gpt-6-luna', { effort: 'none', temperature: 0.2, maxOutputTokens: 800 }), {
    reasoning_effort: 'none', temperature: 0.2, max_completion_tokens: 800,
  })
  assert.deepEqual(chatParams('gpt-4o-mini-2024-07-18', { effort: 'none', temperature: 0.2, maxOutputTokens: 800 }), {
    temperature: 0.2, max_tokens: 800,
  }, 'rolling back to an older model is a settings change')
})

test('every OpenAI chat call site builds its parameters with the shared helper', () => {
  const sites: Record<string, RegExp> = {
    'lib/server/ai/generate-json.ts': /\.\.\.responsesParams\(model, \{ effort: "none"/,
    'supabase/functions/_shared/facts/summary-ladder.ts': /\.\.\.chatParams\(model, \{ effort: "none", temperature: 0\.2, maxOutputTokens: req\.maxTokens \}\)/,
    'supabase/functions/run_case_extract_v4/index.ts': /\.\.\.responsesParams\(body\.model, \{ effort: "none", temperature: 0, maxOutputTokens: OUTPUT_CAPS\.case_extraction \}\)/,
    'supabase/functions/run_case_decision_v1/index.ts': /\.\.\.responsesParams\(model, \{ effort: "none", temperature: 0\.2 \}\)/,
    'supabase/functions/run_report_selfserve_v1/index.ts': /\.\.\.responsesParams\(model, \{ effort: "none", temperature: 0\.2 \}\)/,
    'scripts/tier0-corpus/run.ts': /\.\.\.chatParams\(JUDGE_MODEL, \{ effort: 'low', temperature: 0 \}\)/,
  }
  for (const [file, pattern] of Object.entries(sites)) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, pattern, file)
    assert.doesNotMatch(source, /^\s+temperature: 0(\.2)?,$/m, `${file}: no temperature outside the helper`)
    assert.doesNotMatch(source, /\bmax_tokens:/, `${file}: no max_tokens outside the helper`)
  }
})
