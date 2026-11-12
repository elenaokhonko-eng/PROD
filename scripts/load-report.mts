// Summarises a load run (cutover gate 5): test-results/load/journeys.jsonl from playwright.load.config.ts, plus the
// staging web service's CPU and memory from the Render metrics API for the same window. Counts and timings only.
//   node_modules/.bin/tsx scripts/load-report.ts <journeys> <startIso> <endIso>
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [journeys, start, end] = process.argv.slice(2)
const rows = readFileSync(join('test-results', 'load', 'journeys.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
  .filter((r) => String(r.journeys) === journeys && String(r.at) >= start && String(r.at) <= end)
const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)] : NaN)
const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '-')
const col = (k: string) => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number')
console.log(`| ${journeys} concurrent | journeys ${rows.length}, completed ${rows.filter((r) => r.ok === 'yes').length} |`)
for (const [label, key] of [['Fact check', 'factCheckMs'], ['Generation', 'generationMs'], ['Whole journey', 'totalMs']] as const) {
  console.log(`| ${label} p50 / p95 / max | ${sec(q(col(key), 0.5))} / ${sec(q(col(key), 0.95))} / ${sec(Math.max(...col(key)))} |`)
}
console.log(`| Summary source | ${JSON.stringify(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [String(r.summarySource)]: (m[String(r.summarySource)] ?? 0) + 1 }), {}))} |`)
for (const r of rows.filter((x) => x.ok !== 'yes')) console.log(`| failed journey | ${r.error} |`)

const token = /^\s*key:\s*(\S+)/m.exec(readFileSync(join(homedir(), '.render', 'cli.yaml'), 'utf8'))?.[1]
for (const metric of ['cpu', 'memory']) {
  const url = new URL(`https://api.render.com/v1/metrics/${metric}`)
  url.searchParams.set('resource', 'srv-dabtf78jo6nc738snvh0')
  url.searchParams.set('startTime', start)
  url.searchParams.set('endTime', end)
  url.searchParams.set('resolutionSeconds', '60')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) { console.log(`| ${metric} | unavailable (${res.status}) |`); continue }
  const series = (await res.json()) as Array<{ values?: Array<{ value: number }> }>
  const values = series.flatMap((s) => s.values ?? []).map((v) => v.value)
  const fmt = (v: number) => (metric === 'memory' ? `${(v / 1024 / 1024).toFixed(0)} MB` : `${(v * 100).toFixed(0)}%`)
  console.log(`| Web ${metric} p50 / max | ${values.length ? `${fmt(q(values, 0.5))} / ${fmt(Math.max(...values))}` : '-'} |`)
}
