import { createHash, createHmac, randomUUID } from 'node:crypto'

export type EdgeActorKind = 'user' | 'worker'

export interface EdgeRequestContext {
  actorKind: EdgeActorKind
  actorId: string
  caseId: string
  documentId?: string
  jobId?: string
  jobLockedAt?: string
}

export type AdminEdgeAudience = 'backfill_embeddings_v1' | 'url_catalogue'

const ADMIN_EDGE_AUDIENCES = new Set<AdminEdgeAudience>([
  'backfill_embeddings_v1',
  'url_catalogue',
])

interface AdminEdgeRequestContext {
  actorKind: 'admin'
  actorId: string
}

const SIGNATURE_VERSION = 'v1'
const SIGNED_METHOD = 'POST'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalTarget(audience: string): string {
  return `/functions/v1/${audience}`
}

function signedHeaders(
  audience: string,
  bodyText: string,
  context: EdgeRequestContext | AdminEdgeRequestContext,
): Record<string, string> {
  const secret = process.env.EDGE_PROXY_HMAC_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('EDGE_PROXY_HMAC_SECRET must contain at least 32 bytes')
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const requestId = randomUUID()
  const bodyHash = sha256Hex(bodyText)
  const caseId = context.actorKind === 'admin' ? '' : context.caseId
  const documentId = context.actorKind === 'admin' ? '' : context.documentId ?? ''
  const jobId = context.actorKind === 'admin' ? '' : context.jobId ?? ''
  const jobLockedAt = context.actorKind === 'admin' ? '' : context.jobLockedAt ?? ''
  const target = canonicalTarget(audience)
  const canonical = [
    SIGNATURE_VERSION,
    SIGNED_METHOD,
    target,
    timestamp,
    requestId,
    bodyHash,
    audience,
    context.actorKind,
    context.actorId,
    caseId,
    documentId,
    jobId,
    jobLockedAt,
  ].join('\n')
  const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')

  return {
    'x-harbor-edge-version': SIGNATURE_VERSION,
    'x-harbor-edge-target': target,
    'x-harbor-edge-timestamp': timestamp,
    'x-harbor-edge-request-id': requestId,
    'x-harbor-edge-body-sha256': bodyHash,
    'x-harbor-edge-audience': audience,
    'x-harbor-edge-actor-kind': context.actorKind,
    'x-harbor-edge-actor-id': context.actorId,
    'x-harbor-edge-case-id': caseId,
    'x-harbor-edge-document-id': documentId,
    'x-harbor-edge-job-id': jobId,
    'x-harbor-edge-job-locked-at': jobLockedAt,
    'x-harbor-edge-signature': `${SIGNATURE_VERSION}=${signature}`,
  }
}

export function signEdgeRequest(
  audience: string,
  bodyText: string,
  context: EdgeRequestContext,
): Record<string, string> {
  return signedHeaders(audience, bodyText, context)
}

export function signAdminEdgeRequest(
  audience: AdminEdgeAudience,
  bodyText: string,
  actorId: string,
): Record<string, string> {
  if (!ADMIN_EDGE_AUDIENCES.has(audience)) {
    throw new Error(`Edge audience ${audience} is not approved for admin signing`)
  }
  const canonicalActorId = actorId.trim()
  if (!canonicalActorId) throw new Error('Admin Edge actor ID is required')
  return signedHeaders(audience, bodyText, { actorKind: 'admin', actorId: canonicalActorId })
}
