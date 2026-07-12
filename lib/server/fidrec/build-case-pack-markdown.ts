import type { FidrecSubmissionPack } from "@/lib/types/fidrec-case-pack"

export function buildCasePackMarkdown(pack: FidrecSubmissionPack): string {
  const lines: string[] = []

  lines.push(`# FIDReC Case Pack`)
  lines.push(``)
  lines.push(`**Case ID:** ${pack.case_id}`)
  lines.push(`**Generated:** ${pack.generated_at ? new Date(pack.generated_at).toLocaleString() : "n/a"}`)
  lines.push(`**Version:** ${pack.pack_version}`)
  lines.push(``)

  lines.push(`## Executive Summary`)
  lines.push(``)
  lines.push(pack.executive_summary.narrative || "No executive summary available.")
  lines.push(``)

  if (pack.chronology_of_events && pack.chronology_of_events.length > 0) {
    lines.push(`## Chronology of Events`)
    lines.push(``)
    for (const event of pack.chronology_of_events) {
      const date = event.event_datetime
        ? new Date(event.event_datetime).toLocaleString()
        : "Unknown date"
      lines.push(`- **${date}** — ${event.event_text}`)
      if (event.supporting_evidence && event.supporting_evidence.length > 0) {
        lines.push(`  - Evidence: ${event.supporting_evidence.join(", ")}`)
      }
    }
    lines.push(``)
  }

  if (pack.customer_position?.points && pack.customer_position.points.length > 0) {
    lines.push(`## Customer Position`)
    lines.push(``)
    lines.push(pack.customer_position.narrative)
    lines.push(``)
    for (const point of pack.customer_position.points) {
      lines.push(`- ${point.statement}`)
      if (point.evidence_labels.length > 0) {
        lines.push(`  - Evidence: ${point.evidence_labels.join(", ")}`)
      }
    }
    lines.push(``)
  }

  if (pack.bank_position?.stated_grounds && pack.bank_position.stated_grounds.length > 0) {
    lines.push(`## Bank Position`)
    lines.push(``)
    lines.push(pack.bank_position.narrative)
    lines.push(``)
  }

  if (pack.issues_in_dispute && pack.issues_in_dispute.length > 0) {
    lines.push(`## Issues in Dispute`)
    lines.push(``)
    for (const issue of pack.issues_in_dispute) {
      lines.push(`### ${issue.issue_title}`)
      lines.push(``)
      lines.push(issue.explanation)
      lines.push(``)
      lines.push(`**Customer position:** ${issue.customer_position}`)
      lines.push(``)
      lines.push(`**Bank position:** ${issue.bank_position}`)
      lines.push(``)
      if (issue.evidence_available.length > 0) {
        lines.push(`**Evidence available:** ${issue.evidence_available.join(", ")}`)
        lines.push(``)
      }
      if (issue.evidence_required.length > 0) {
        lines.push(`**Evidence required:** ${issue.evidence_required.join(", ")}`)
        lines.push(``)
      }
    }
  }

  if (pack.evidence_bundle && pack.evidence_bundle.length > 0) {
    lines.push(`## Evidence Bundle`)
    lines.push(``)
    for (const item of pack.evidence_bundle) {
      lines.push(`### ${item.evidence_label} — ${item.title}`)
      lines.push(``)
      lines.push(item.summary)
      lines.push(``)
      lines.push(`_Why it matters:_ ${item.why_it_matters}`)
      lines.push(``)
      if (item.supports_issues.length > 0) {
        lines.push(`_Supports issues:_ ${item.supports_issues.join(", ")}`)
        lines.push(``)
      }
    }
  }

  if (pack.outstanding_evidence) {
    const { requested_from_bank, requested_from_customer } = pack.outstanding_evidence
    if (requested_from_bank.length > 0 || requested_from_customer.length > 0) {
      lines.push(`## Outstanding Evidence`)
      lines.push(``)
      if (requested_from_bank.length > 0) {
        lines.push(`### Requested from bank`)
        for (const text of requested_from_bank) {
          lines.push(`- ${text}`)
        }
        lines.push(``)
      }
      if (requested_from_customer.length > 0) {
        lines.push(`### Requested from customer`)
        for (const text of requested_from_customer) {
          lines.push(`- ${text}`)
        }
        lines.push(``)
      }
    }
  }

  if (pack.applicable_regulatory_framework?.provisions && pack.applicable_regulatory_framework.provisions.length > 0) {
    lines.push(`## Applicable Regulatory Framework`)
    lines.push(``)
    lines.push(pack.applicable_regulatory_framework.introductory_text)
    lines.push(``)
    for (const provision of pack.applicable_regulatory_framework.provisions) {
      lines.push(`- **${provision.document_name}** — ${provision.clause_reference}: ${provision.clause_title}`)
    }
    lines.push(``)
  }

  if (pack.annexures && pack.annexures.length > 0) {
    lines.push(`## Annexures`)
    lines.push(``)
    for (const annex of pack.annexures) {
      lines.push(`- **${annex.annexure_label}** — ${annex.evidence_label}: ${annex.title}`)
    }
    lines.push(``)
  }

  return lines.join("\n")
}
