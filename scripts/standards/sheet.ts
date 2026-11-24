// The verification sheet for one draft version: every clause as it will be stored, beside its source page, and
// every piece of text the manifest leaves out, so the person verifying sees both what is held and what is not.
// Written outside the repo (it carries the document's text); opened from disk in a browser.

import type { Manifest } from "./manifest.ts"
import { buildStream, findPieces, normaliseClauseText, pageAt, type CutClause } from "./segment.ts"

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export interface SheetInput {
  manifest: Manifest
  manifestRepoPath: string
  pages: string[]
  cut: CutClause[]
  /** URL of the source file relative to the sheet, for the viewer beside the clauses. */
  sourceHref: string
  generatedAt: string
}

export function buildSheet(input: SheetInput): string {
  const { manifest: m, pages, cut } = input
  const d = m.document
  const v = m.version
  const stream = buildStream(pages, m.extraction.remove)
  const pieces = findPieces(stream, m.markers, m.extraction.end)
  const byKey = new Map(cut.map((c) => [c.clause_key, c]))
  const meta = new Map(m.clauses.map((c) => [c.clause_key, c]))
  const pdf = m.extraction.format === "pdf"
  const pageLink = (p: number) => pdf ? `${input.sourceHref}#page=${p}` : input.sourceHref

  const seen = new Set<string>()
  const rows: string[] = []
  const lead = stream.text.slice(0, pieces[0]?.start ?? 0)
  if (normaliseClauseText(lead)) rows.push(droppedRow(lead, 1, "before the first marker", pageLink(1)))
  for (const piece of pieces) {
    const raw = stream.text.slice(piece.start, piece.end)
    const page = pageAt(stream, piece.start)
    if (piece.marker.clause === null) {
      if (normaliseClauseText(raw)) rows.push(droppedRow(raw, page, `marker ${piece.index}`, pageLink(page)))
      continue
    }
    const key = piece.marker.clause
    if (seen.has(key)) {
      rows.push(`<tr class="cont"><td colspan="2"><span class="k">${esc(key)}</span> continues (marker ${piece.index}, page ${page})</td></tr>`)
      continue
    }
    seen.add(key)
    const c = byKey.get(key) as CutClause
    const info = meta.get(key)
    const scope = info?.instrument_scope ? info.instrument_scope.join(", ") : `document: ${d.instrument_scope.join(", ")}`
    rows.push(`<tr id="${esc(key)}">
<td class="m"><div class="k">${esc(key)}</div>
<div>ref ${esc(info?.clause_ref ?? "—")}</div>
<div>${c.pages.map((p) => `<a href="${esc(pageLink(p))}" target="src" data-page="${p}">p. ${p}</a>`).join(" ")}</div>
<div>scope: ${esc(scope)}</div>
${info?.tags.length ? `<div>tags: ${esc(info.tags.join(", "))}</div>` : ""}
${info?.effective_from_override ? `<div><b>in force from ${esc(info.effective_from_override)}</b></div>` : ""}
${info?.heading_path.length ? `<div class="h">${esc(info.heading_path.join(" › "))}</div>` : ""}
${info?.note ? `<div class="n">${esc(info.note)}</div>` : ""}
<div class="sha">${c.text_sha256.slice(0, 16)}…</div>
<label><input type="checkbox"> checked</label></td>
<td class="t">${esc(c.text)}</td></tr>`)
  }
  const tail = stream.text.slice(pieces[pieces.length - 1]?.end ?? 0)
  // A selected-sections version says where its held text ends; the rest of the document is not listed.
  if (v.coverage === "full" && normaliseClauseText(tail)) rows.push(droppedRow(tail, pageAt(stream, pieces[pieces.length - 1]?.end ?? 0), "after the end marker", pageLink(pages.length)))

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Verify ${esc(d.document_key)} ${esc(v.version_label)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:0;color:#1a1a1a;background:#fff}
header{padding:12px 16px;border-bottom:1px solid #ddd}
h1{font-size:18px;margin:0 0 6px}
.wrap{display:flex;height:calc(100vh - 210px)}
.list{flex:1 1 55%;overflow:auto;padding:0 8px}
.view{flex:1 1 45%;border-left:1px solid #ddd}
.view iframe{width:100%;height:100%;border:0}
table{border-collapse:collapse;width:100%}
td{vertical-align:top;border-bottom:1px solid #eee;padding:8px 6px}
td.m{width:210px;font-size:12px;color:#444}
.k{font-family:ui-monospace,monospace;font-weight:600;color:#000}
.sha{font-family:ui-monospace,monospace;color:#888}
.h{color:#666;font-style:italic}.n{color:#8a4b00}
tr.drop td{color:#888;background:#fafafa;font-size:12px}
tr.cont td{color:#555;font-size:12px;background:#f4f8ff}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0;font-size:13px}
dt{color:#666}
</style></head><body>
<header>
<h1>Verification sheet: ${esc(d.title)} — ${esc(v.version_label)}</h1>
<dl>
<dt>document_key</dt><dd>${esc(d.document_key)} (${esc(d.binding_level)}, ${esc(d.publisher)})</dd>
<dt>in force from</dt><dd>${esc(v.effective_from ?? "not set")}; issued ${esc(v.issued_on ?? "not set")}</dd>
<dt>source</dt><dd>${v.source_url ? `<a href="${esc(v.source_url)}">${esc(v.source_url)}</a>` : esc(v.provenance)}; fetched ${esc(v.retrieved_at)}</dd>
<dt>file</dt><dd>${esc(v.snapshot_path)}, sha256 ${esc(v.content_sha256)}</dd>
<dt>manifest</dt><dd>${esc(input.manifestRepoPath)}; ${m.clauses.length} clauses, coverage ${esc(v.coverage)}; extractor ${esc(m.extraction.extractor)}</dd>
<dt>to check</dt><dd>Each clause's text against the page on the right (click a page link); that grey rows (left out) hold nothing that should be a clause; the dates above. Verifying is done in the database by a person, not by the loader.</dd>
</dl>
<div style="font-size:12px;color:#888;margin-top:4px">Generated ${esc(input.generatedAt)} by scripts/standards/load.ts. Text is the stored form: whitespace collapsed, Unicode NFKC; footnote reference numbers stay where the PDF puts them.</div>
</header>
<div class="wrap">
<div class="list"><table>${rows.join("\n")}</table></div>
<div class="view"><iframe name="src" src="${esc(pageLink(1))}"></iframe></div>
</div>
<script>
document.querySelectorAll('a[target=src]').forEach(function(a){a.addEventListener('click',function(e){
  e.preventDefault();var f=document.querySelector('iframe[name=src]');f.src='about:blank';setTimeout(function(){f.src=a.getAttribute('href')},30);});});
</script>
</body></html>
`
}

function droppedRow(raw: string, page: number, where: string, href: string): string {
  const text = normaliseClauseText(raw)
  return `<tr class="drop"><td>left out (${esc(where)}), <a href="${esc(href)}" target="src">p. ${page}</a></td><td>${esc(text)}</td></tr>`
}
