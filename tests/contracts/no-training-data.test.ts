import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// Elena, 8 Nov: nothing from a person's story is kept for model training. Regex masking is not anonymisation and it
// contradicts the Privacy Policy. The table stays until a later migration drops it; no code may write to (or read
// from) it, so production never receives data in it.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) return []
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : []
  })
}

test('no application, worker or Edge Function code touches anonymized_training_data', () => {
  const offenders = ['app', 'lib', 'worker', 'components', 'hooks', 'supabase/functions']
    .flatMap(files)
    .filter((path) => readFileSync(path, 'utf8').includes('anonymized_training_data'))
  assert.deepEqual(offenders, [])
})
