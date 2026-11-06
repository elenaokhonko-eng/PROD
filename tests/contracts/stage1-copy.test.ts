import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// Stage 1 demo review, 6 Nov 2026: copy rules for every user-facing surface of the free path.

const ROOTS = ['app', 'components', 'lib/harbor', 'supabase/functions/bright-function', 'supabase/functions/_shared/facts']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(tsx?|ts)$/.test(name) ? [path] : []
  })
}

// Code comments may use internal names; only the text a person can see is checked.
function visible(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sources = ROOTS.flatMap(files).map((path) => ({ path, text: visible(readFileSync(path, 'utf8')) }))

function offenders(pattern: RegExp): string[] {
  return sources.filter((s) => pattern.test(s.text)).map((s) => s.path)
}

test('E1: one name. "Lumi" never appears as text (component and asset names may keep it)', () => {
  assert.deepEqual(offenders(/(?<![A-Za-z/_-])Lumi(?![A-Za-z])/), [])
})

test('D2: consultation is offered by email, never "not currently available"', () => {
  assert.deepEqual(offenders(/consultation[^'"`]{0,40}not currently available/i), [])
})

test('D1: paid packs say "Available shortly", never a date', () => {
  assert.deepEqual(offenders(/Available from/), [])
})

test('C1/D4: no internal names in titles and copy: Tier-0, "the server confirms"', () => {
  assert.deepEqual(offenders(/\(Tier-0\)|title: "[^"]*Tier/), [])
  assert.deepEqual(offenders(/the server confirms/i), [])
})

test('D3: the automated-output notice carries the consultation offer wherever it appears', () => {
  const old = /Generated automatically by GuideBuoy AI\. It has not been reviewed by a person\./
  assert.deepEqual(offenders(old), [])
})
