import { appendFileSync, readFileSync } from 'node:fs'
import { request } from '@playwright/test'

const shaPattern = /^[0-9a-f]{40}$/i
const defaultProductionHosts = ['guidebuoyaisg.onrender.com', 'guidebuoyai.sg', 'www.guidebuoyai.sg']

async function main() {
  const baseUrl = requireUrl('HARBOR_PREVIEW_BASE_URL')
  if (baseUrl.protocol !== 'https:') throw new Error('Preview release verification requires HTTPS.')

  const expectedHost = requiredEnvironment('HARBOR_PREVIEW_EXPECTED_HOST').toLowerCase()
  if (baseUrl.hostname.toLowerCase() !== expectedHost) {
    throw new Error('Preview release verification host does not match HARBOR_PREVIEW_EXPECTED_HOST.')
  }
  if (!baseUrl.hostname.toLowerCase().endsWith('.onrender.com')) {
    throw new Error('Preview release verification must target the staging Render hostname.')
  }

  const productionHosts = configuredHosts('HARBOR_PRODUCTION_HOSTS')
  if (productionHosts.has(baseUrl.hostname.toLowerCase())) {
    throw new Error('Refusing to verify release identity against a production hostname.')
  }

  const expectedSha = requiredEnvironment('HARBOR_RELEASE_SHA').toLowerCase()
  if (!shaPattern.test(expectedSha)) throw new Error('HARBOR_RELEASE_SHA must be a full 40-character Git SHA.')

  const storageStatePath = requiredEnvironment('HARBOR_PREVIEW_RELEASE_STORAGE_STATE')
  assertAuthenticatedStorageState(storageStatePath)

  await assertReleaseEndpointRejectsAnonymous(baseUrl.origin)

  const api = await request.newContext({
    baseURL: baseUrl.origin,
    storageState: storageStatePath,
    extraHTTPHeaders: { accept: 'application/json' },
  })

  try {
    const response = await api.get('/api/health/release', { maxRedirects: 0 })
    if (response.headers().location) throw new Error('Release identity endpoint attempted a redirect.')
    if (response.status() === 401 || response.status() === 403) {
      throw new Error('Release identity endpoint rejected the authenticated staging request.')
    }
    if (!response.ok()) throw new Error(`Release identity endpoint failed with HTTP ${response.status()}.`)

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error('Release identity endpoint did not return JSON.')
    }

    const commitSha = typeof body === 'object' && body !== null
      ? (body as { commitSha?: unknown }).commitSha
      : undefined
    if (typeof commitSha !== 'string' || !shaPattern.test(commitSha)) {
      throw new Error('Release identity endpoint returned a malformed commitSha.')
    }
    if (commitSha.toLowerCase() !== expectedSha) {
      throw new Error('Deployed preview commit SHA does not match HARBOR_RELEASE_SHA.')
    }

    exportValue('HARBOR_PREVIEW_CONFIRMED_SHA', commitSha.toLowerCase())
    console.log('Verified authenticated preview release identity.')
  } finally {
    await api.dispose()
  }
}

async function assertReleaseEndpointRejectsAnonymous(origin: string) {
  const anonymousApi = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { accept: 'application/json' },
  })

  try {
    const response = await anonymousApi.get('/api/health/release', { maxRedirects: 0 })
    if (response.headers().location) {
      throw new Error('Release identity endpoint redirected an unauthenticated request instead of rejecting it.')
    }
    if (response.status() !== 401 && response.status() !== 403) {
      throw new Error('Release identity endpoint must reject unauthenticated requests before CI trusts its SHA.')
    }
  } finally {
    await anonymousApi.dispose()
  }
}

function assertAuthenticatedStorageState(path: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Unable to read authenticated Clerk storage state for preview release verification.')
  }
  const cookies = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { cookies?: unknown }).cookies)
    ? (parsed as { cookies: Array<{ name?: unknown }> }).cookies
    : []
  const origins = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { origins?: unknown }).origins)
    ? (parsed as { origins: unknown[] }).origins
    : []
  const hasClerkCookie = cookies.some((cookie) => typeof cookie.name === 'string' && /(?:^__session$|clerk)/i.test(cookie.name))
  if (!hasClerkCookie && origins.length === 0) {
    throw new Error('Preview release verification requires a non-empty authenticated Clerk storage state.')
  }
}

function requireUrl(name: string) {
  try {
    return new URL(requiredEnvironment(name))
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`)
  }
}

function configuredHosts(name: string) {
  const configured = requiredEnvironment(name)
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  if (configured.length === 0) throw new Error(`${name} must list production hostnames.`)
  return new Set([...defaultProductionHosts, ...configured])
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function exportValue(name: string, value: string) {
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`, 'utf8')
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name.toLowerCase()}=${value}\n`, 'utf8')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
