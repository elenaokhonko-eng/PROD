import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolve } from 'node:path'
import { assertReleaseFixtures, requiredReleaseFixturePaths } from './release-fixtures'

const templatePath = resolve(process.cwd(), 'tests', 'release', 'fixtures', 'harbor-release.template.json')

test('release fixture template satisfies schema version 1', () => {
  const template = JSON.parse(readFileSync(templatePath, 'utf8'))
  const parsed = assertReleaseFixtures(template, { allowPlaceholders: true })

  assert.throws(
    () => assertReleaseFixtures(template),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /users\.userA\.supabaseUuid/)
      assert.doesNotMatch(error.message, /<seeded-user-a-supabase-uuid>/)
      return true
    },
  )
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.users.userA.disposable, true)
  assert.equal(parsed.users.userB.disposable, true)
  assert.equal(parsed.users.deletionUser.disposable, true)
  assert.equal(new Set(requiredReleaseFixturePaths).size, requiredReleaseFixturePaths.length)
  assert.ok(parsed.serviceRole.protectedPaths.length > 0)
})

test('release fixture validation requires disposable staging identities', () => {
  const template = JSON.parse(readFileSync(templatePath, 'utf8'))
  const valid = materializeTemplate(template)
  ;(valid as { users: { userA: { disposable?: boolean } } }).users.userA.disposable = false

  assert.throws(
    () => assertReleaseFixtures(valid),
    /users\.userA\.disposable/,
  )
})

test('release fixture validation reports incomplete fixture paths without echoing values', () => {
  assert.throws(
    () => assertReleaseFixtures({ schemaVersion: 1, collaboration: { expiredInvitationToken: 'must-not-echo' } }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /users\.userA\.supabaseUuid/)
      assert.doesNotMatch(error.message, /must-not-echo/)
      return true
    },
  )
})

test('release fixture validation requires distinct controlled user identities and cases', () => {
  const template = JSON.parse(readFileSync(templatePath, 'utf8'))
  const valid = assertReleaseFixtures(materializeTemplate(template))

  const duplicateIdentity = structuredClone(valid)
  duplicateIdentity.users.userB.supabaseUuid = duplicateIdentity.users.userA.supabaseUuid
  assert.throws(
    () => assertReleaseFixtures(duplicateIdentity),
    /users\.\*\.supabaseUuid must be distinct/,
  )

  const duplicateCase = structuredClone(valid)
  duplicateCase.users.deletionUser.ownedCaseId = duplicateCase.users.userA.ownedCaseId
  assert.throws(
    () => assertReleaseFixtures(duplicateCase),
    /users\.\*\.ownedCaseId must be distinct/,
  )

  const duplicateFixtureCase = structuredClone(valid)
  duplicateFixtureCase.payments.delayedEntitlement.caseId = duplicateFixtureCase.evidence.uploadCaseId
  assert.throws(
    () => assertReleaseFixtures(duplicateFixtureCase),
    /all fixture case IDs must be distinct disposable synthetic cases/,
  )
})

function materializeTemplate(value: unknown) {
  let uuidIndex = 0
  let textIndex = 0

  const visit = (item: unknown, key = ''): unknown => {
    if (typeof item === 'string' && /^<[^>]+>$/.test(item)) {
      if (key === 'sessionId') return 'cs_test_fixture_session'
      if (key === 'email') return 'release-fixture@example.test'
      if (/(?:Uuid|CaseId|PurchaseId|EvidenceId)$/.test(key)) {
        uuidIndex += 1
        return `00000000-0000-4000-8000-${String(uuidIndex).padStart(12, '0')}`
      }
      textIndex += 1
      return `fixture-value-${textIndex}`
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry))
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item).map(([childKey, child]) => [childKey, visit(child, childKey)]),
      )
    }
    return item
  }

  return visit(value)
}
