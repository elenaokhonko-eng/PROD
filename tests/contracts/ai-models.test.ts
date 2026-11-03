import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { getOpenAiModel } from '../../lib/server/ai/generate-json'

// Google returns 404 for gemini-2.0-* and gemini-2.5-* on API keys created after their retirement for new users,
// which silently broke evidence processing and transcription on the November 2026 staging keys.
const retiredGeminiModel = /gemini-2\.(?:0|5)-(?:flash|pro)/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

test('no app, lib or Edge function code defaults to a retired Gemini model', () => {
  const offenders = ['app', 'lib', 'supabase/functions']
    .flatMap(sources)
    .filter((path) => retiredGeminiModel.test(readFileSync(path, 'utf8')))
  assert.deepEqual(offenders, [])
})

test('OPENAI_MODEL is normalised to the lower-case model ID', () => {
  const previous = process.env.OPENAI_MODEL
  try {
    process.env.OPENAI_MODEL = ' GPT-4.1-mini '
    assert.equal(getOpenAiModel(), 'gpt-4.1-mini')
    delete process.env.OPENAI_MODEL
    assert.equal(getOpenAiModel(), 'gpt-4.1-mini')
  } finally {
    if (previous === undefined) delete process.env.OPENAI_MODEL
    else process.env.OPENAI_MODEL = previous
  }
})
