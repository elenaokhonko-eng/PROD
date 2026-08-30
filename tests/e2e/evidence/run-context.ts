import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type HarborLane = 'public' | 'synthetic' | 'authenticated' | 'preview'
export type EvidenceClass = 'local/static' | 'synthetic-provider' | 'preview-provider-delivered' | 'skipped'

export type HarborRunContext = {
  schemaVersion: 1
  lane: HarborLane
  evidenceClass: Exclude<EvidenceClass, 'skipped'>
  releaseSha: string
  expectedReleaseSha: string | null
  previewConfirmedSha: string | null
  environmentRevision: string
  workerVersion: string
  gitRef: string
  ciRunId: string | null
  ciRunAttempt: string | null
}

const shaPattern = /^[0-9a-f]{40}$/i

export function resolveRunContext(rootDir: string, lane: HarborLane): HarborRunContext {
  const releaseSha = git(rootDir, ['rev-parse', 'HEAD'])
  if (!shaPattern.test(releaseSha)) throw new Error(`Unable to resolve an exact 40-character git SHA; received ${releaseSha}.`)

  const expectedReleaseSha = optionalEnvironment('HARBOR_RELEASE_SHA')
  if (expectedReleaseSha && !shaPattern.test(expectedReleaseSha)) {
    throw new Error('HARBOR_RELEASE_SHA must be the exact 40-character integrated commit SHA.')
  }
  if (expectedReleaseSha && expectedReleaseSha.toLowerCase() !== releaseSha.toLowerCase()) {
    throw new Error(`Refusing to report evidence for HEAD ${releaseSha}; HARBOR_RELEASE_SHA is ${expectedReleaseSha}.`)
  }

  if (isLiveLane(lane) && !expectedReleaseSha) {
    throw new Error(`HARBOR_RELEASE_SHA is required for the ${lane} lane.`)
  }

  const previewConfirmedSha = optionalEnvironment('HARBOR_PREVIEW_CONFIRMED_SHA')
  if (previewConfirmedSha && !shaPattern.test(previewConfirmedSha)) {
    throw new Error('HARBOR_PREVIEW_CONFIRMED_SHA must be a full 40-character commit SHA from /api/health/release.')
  }
  if (isLiveLane(lane) && !previewConfirmedSha) {
    throw new Error(
      `HARBOR_PREVIEW_CONFIRMED_SHA is required for the ${lane} lane. ` +
      'Set it from /api/health/release before collecting provider-delivered evidence.',
    )
  }
  if (isLiveLane(lane) && expectedReleaseSha && previewConfirmedSha && previewConfirmedSha.toLowerCase() !== expectedReleaseSha.toLowerCase()) {
    throw new Error(
      `Refusing ${lane} evidence: preview reports ${previewConfirmedSha}, expected ${expectedReleaseSha}.`,
    )
  }

  const environmentRevision = isLiveLane(lane)
    ? requireEnvironment('HARBOR_ENVIRONMENT_REVISION')
    : optionalEnvironment('HARBOR_ENVIRONMENT_REVISION') ?? 'local-unversioned'
  const workerVersion = isLiveLane(lane)
    ? requireEnvironment('HARBOR_WORKER_VERSION')
    : optionalEnvironment('HARBOR_WORKER_VERSION') ?? 'not-applicable'

  return {
    schemaVersion: 1,
    lane,
    evidenceClass: evidenceClassForLane(lane),
    releaseSha,
    expectedReleaseSha,
    previewConfirmedSha,
    environmentRevision,
    workerVersion,
    gitRef: git(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    ciRunId: optionalEnvironment('GITHUB_RUN_ID'),
    ciRunAttempt: optionalEnvironment('GITHUB_RUN_ATTEMPT'),
  }
}

export function evidenceClassForLane(lane: HarborLane): Exclude<EvidenceClass, 'skipped'> {
  if (lane === 'synthetic') return 'synthetic-provider'
  if (isLiveLane(lane)) return 'preview-provider-delivered'
  return 'local/static'
}

export function requireEnvironment(name: string) {
  const value = optionalEnvironment(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

type FixtureUser = 'userA' | 'userB' | 'deletionUser'

export function resolveAuthStatePath(rootDir: string, user: FixtureUser) {
  const configured = user === 'userA'
    ? optionalEnvironment('HARBOR_AUTH_STORAGE_STATE_USER_A') ??
      optionalEnvironment('HARBOR_AUTH_STORAGE_STATE') ??
      optionalEnvironment('SLICE5_AUTH_STORAGE_STATE') ??
      'tests/e2e/.auth/harbor-user-a.json'
    : user === 'userB'
      ? optionalEnvironment('HARBOR_AUTH_STORAGE_STATE_USER_B') ?? 'tests/e2e/.auth/harbor-user-b.json'
      : optionalEnvironment('HARBOR_AUTH_STORAGE_STATE_DELETION_USER') ??
        'tests/e2e/.auth/harbor-deletion-user.json'
  return resolve(rootDir, configured)
}

export function requireAuthState(rootDir: string, user: FixtureUser) {
  const path = resolveAuthStatePath(rootDir, user)
  if (!existsSync(path)) {
    throw new Error(
      `Authenticated Harbor lane requires ${user} Clerk storage state at ${path}. ` +
        `Set ${authStateEnvironmentName(user)}.`,
    )
  }
  return path
}

function authStateEnvironmentName(user: FixtureUser) {
  if (user === 'userA') return 'HARBOR_AUTH_STORAGE_STATE_USER_A'
  if (user === 'userB') return 'HARBOR_AUTH_STORAGE_STATE_USER_B'
  return 'HARBOR_AUTH_STORAGE_STATE_DELETION_USER'
}

export function isLiveLane(lane: HarborLane) {
  return lane === 'authenticated' || lane === 'preview'
}

function optionalEnvironment(name: string) {
  const value = process.env[name]?.trim()
  return value || null
}

function git(rootDir: string, args: string[]) {
  try {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(`Failed to run git ${args.join(' ')}: ${String(error)}`)
  }
}
