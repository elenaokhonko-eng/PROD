import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import type { EvidenceClass, HarborLane } from '../evidence/run-context'

export type HarborEvidenceReporterOptions = {
  lane: HarborLane
  evidenceClass: Exclude<EvidenceClass, 'skipped'>
  outputDir: string
  releaseSha: string
  previewConfirmedSha: string | null
  environmentRevision: string
  workerVersion: string
}

type EvidenceTest = {
  sourceSha: string
  id: string
  title: string
  project: string
  file: string
  line: number
  status: TestResult['status']
  evidenceClass: EvidenceClass
  retry: number
  durationMs: number
  errors: string[]
  artifacts: Array<{ name: string; contentType: string; path: string | null }>
  annotations: Array<{ type: string; description?: string }>
}

export default class HarborEvidenceReporter implements Reporter {
  private readonly options: HarborEvidenceReporterOptions
  private readonly tests: EvidenceTest[] = []
  private startedAt = new Date().toISOString()
  private rootDir = process.cwd()

  constructor(options: HarborEvidenceReporterOptions) {
    this.options = options
  }

  onBegin(config: FullConfig, _suite: Suite) {
    this.rootDir = config.rootDir
    this.startedAt = new Date().toISOString()
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const titlePath = test.titlePath()
    this.tests.push({
      sourceSha: this.options.releaseSha,
      id: test.id,
      title: titlePath.join(' › '),
      project: test.parent.project()?.name ?? titlePath[0] ?? 'unknown',
      file: relative(this.rootDir, test.location.file).replaceAll('\\', '/'),
      line: test.location.line,
      status: result.status,
      evidenceClass: evidenceClassForTest(test, result, this.options.evidenceClass),
      retry: result.retry,
      durationMs: result.duration,
      errors: result.errors.map((error) => redact(error.stack ?? error.message ?? String(error))),
      artifacts: result.attachments.map((attachment) => ({
        name: redact(attachment.name),
        contentType: attachment.contentType,
        path: attachment.path ? relative(this.rootDir, attachment.path).replaceAll('\\', '/') : null,
      })),
      annotations: test.annotations.map((annotation) => ({
        type: annotation.type,
        description: annotation.description ? redact(annotation.description) : undefined,
      })),
    })
  }

  async onEnd(result: FullResult) {
    const finishedAt = new Date().toISOString()
    const outputDir = resolve(this.options.outputDir)
    const outputPath = resolve(outputDir, `${this.options.lane}-${this.options.releaseSha}.json`)
    const temporaryPath = `${outputPath}.tmp`
    const counts = this.tests.reduce<Record<TestResult['status'], number>>(
      (current, item) => ({ ...current, [item.status]: current[item.status] + 1 }),
      { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 },
    )

    const report = {
      schemaVersion: 1,
      run: {
        lane: this.options.lane,
        evidenceClass: this.options.evidenceClass,
        releaseSha: this.options.releaseSha,
        previewConfirmedSha: this.options.previewConfirmedSha,
        environmentRevision: this.options.environmentRevision,
        workerVersion: this.options.workerVersion,
        ciRunId: process.env.GITHUB_RUN_ID ?? null,
        ciRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        startedAt: this.startedAt,
        finishedAt,
        durationMs: result.duration,
        status: result.status,
      },
      summary: counts,
      tests: this.tests,
    }

    mkdirSync(outputDir, { recursive: true })
    writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, outputPath)
  }
}

function evidenceClassForTest(
  test: TestCase,
  result: TestResult,
  fallback: Exclude<EvidenceClass, 'skipped'>,
): EvidenceClass {
  if (result.status === 'skipped') return 'skipped'
  const annotation = test.annotations.find((item) => item.type === 'evidence-class')?.description
  if (annotation === 'local/static' || annotation === 'synthetic-provider' || annotation === 'preview-provider-delivered') {
    return annotation
  }
  return fallback
}

export function redact(value: string) {
  let redacted = value
  for (const secret of secretEnvironmentValues()) redacted = redacted.replaceAll(secret, '[REDACTED]')

  return redacted
    .replace(/\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:sk|rk|whsec)_(?:live|test)_[A-Za-z0-9_]+\b/g, '[REDACTED_STRIPE_SECRET]')
    .replace(/\bcs_(?:live|test)_[A-Za-z0-9_]+\b/g, '[REDACTED_STRIPE_SESSION]')
    .replace(/([?&](?:token|session_id|code|key)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
}

function secretEnvironmentValues() {
  const values = Object.entries(process.env)
    .filter(([name, value]) =>
      value && /(?:SECRET|TOKEN|KEY|PASSWORD|COOKIE|WEBHOOK|AUTH_STORAGE_STATE|FIXTURES_JSON|STATE_CASES_JSON|SMTP_TEST_RECIPIENT)/i.test(name),
    )
    .flatMap(([name, value]) => [
      value!,
      ...(/(?:FIXTURES_JSON|STATE_CASES_JSON)/i.test(name) ? jsonStringValues(value!) : []),
    ])
    .filter((item) => item.length >= 6)

  return Array.from(new Set(values)).sort((left, right) => right.length - left.length)
}

function jsonStringValues(value: string) {
  try {
    const pending: unknown[] = [JSON.parse(value)]
    const strings: string[] = []
    while (pending.length) {
      const item = pending.pop()
      if (typeof item === 'string') strings.push(item)
      else if (Array.isArray(item)) pending.push(...item)
      else if (item && typeof item === 'object') pending.push(...Object.values(item))
    }
    return strings
  } catch {
    return []
  }
}
