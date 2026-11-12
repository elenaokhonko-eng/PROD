import assert from 'node:assert/strict'
import test from 'node:test'
import { redact } from '../e2e/reporters/harbor-evidence-reporter'

test('evidence text redacts credentials and sensitive request metadata', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdXBhYmFzZV91dWlkIjoic2VjcmV0In0.signature'
  const source = [
    `Authorization: Bearer ${jwt}`,
    'Cookie: __session=private-value',
    'https://preview.invalid/invite?token=private-token&safe=yes',
    'sk_test_abcdefghijklmnopqrstuvwxyz',
    'whsec_test_abcdefghijklmnopqrstuvwxyz',
    'cs_test_private_checkout_session',
  ].join('\n')

  const result = redact(source)
  assert.doesNotMatch(result, /private-value|private-token|private_checkout_session|supabase_uuid|abcdefghijklmnopqrstuvwxyz/)
  assert.match(result, /\[REDACTED/)
  assert.match(result, /safe=yes/)
})

test('evidence text redacts individual values nested in fixture JSON', () => {
  const previous = process.env.HARBOR_RELEASE_FIXTURES_JSON
  process.env.HARBOR_RELEASE_FIXTURES_JSON = JSON.stringify({
    collaboration: { expiredInvitationToken: 'fixture-invitation-secret' },
    payments: { sessionId: 'cs_test_fixture_nested_session' },
  })

  try {
    const result = redact('failed /invite/fixture-invitation-secret for cs_test_fixture_nested_session')
    assert.doesNotMatch(result, /fixture-invitation-secret|fixture_nested_session/)
    assert.match(result, /\[REDACTED/)
  } finally {
    if (previous === undefined) delete process.env.HARBOR_RELEASE_FIXTURES_JSON
    else process.env.HARBOR_RELEASE_FIXTURES_JSON = previous
  }
})
