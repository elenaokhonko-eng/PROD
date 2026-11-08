import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Hardening item 4 (8 Nov): a double-click on "Confirm and continue" started two generations on staging, because the
// second click lands before the button re-renders as disabled. The e2e test free-evaluation-edge-cases.spec.ts (a)
// counts the requests; this pins the guard.
test('confirming the facts ignores a second click while the first is still saving', () => {
  const panel = readFileSync('components/state-machine/facts/confirm-facts-panel.tsx', 'utf8')
  assert.match(panel, /const confirming = useRef\(false\)/)
  assert.match(
    panel,
    /async function handleConfirm\(\) \{\s*if \(confirming\.current\) return\s*confirming\.current = true\s*try \{\s*const result = await confirm\.mutateAsync\(\)\s*onConfirmed\(result\.snapshotId\)\s*\} finally \{\s*confirming\.current = false\s*\}/,
  )
})
