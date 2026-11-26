// The idempotency key for starting a case from a story: the same story gets the same key, so a retry can't create a
// second case.

const BOOTSTRAP_IDEMPOTENCY_KEY = 'gb_bootstrap_idempotency_key'
const BOOTSTRAP_REQUEST_FINGERPRINT = 'gb_bootstrap_request_fingerprint'

export async function getOrCreateBootstrapIdempotencyKey(requestBody: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(requestBody))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const existing = sessionStorage.getItem(BOOTSTRAP_IDEMPOTENCY_KEY)
  if (existing && sessionStorage.getItem(BOOTSTRAP_REQUEST_FINGERPRINT) === fingerprint) {
    return existing
  }
  const created = crypto.randomUUID()
  sessionStorage.setItem(BOOTSTRAP_IDEMPOTENCY_KEY, created)
  sessionStorage.setItem(BOOTSTRAP_REQUEST_FINGERPRINT, fingerprint)
  return created
}

export function clearBootstrapIdempotencyKey() {
  sessionStorage.removeItem(BOOTSTRAP_IDEMPOTENCY_KEY)
  sessionStorage.removeItem(BOOTSTRAP_REQUEST_FINGERPRINT)
}
