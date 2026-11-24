// What the model may see and say once the FIDReC update's sections are on (Lane 6, assembly; brief v5 4h and section 4).
//
// 1. Records never go into the model's prompt (Elena's condition B). Device references and labels, token references,
//    IP addresses, IP lookup results and the record lines themselves are printed by the server only. The record facts
//    are left out of the model's facts, the technical-record documents are left out of its document excerpts, and any
//    of those values in the other texts it is given (the story, the institution's letter, other documents) is
//    replaced before it is sent. IP-address shapes are replaced wherever they appear.
// 2. No verdict wording in model output (brief section 4): the pack never states, as its own finding, that anyone
//    breached, violated, failed to meet, did not comply with, is liable for, or was negligent, grossly negligent or
//    reckless. The documents' own terms may appear inside quotation marks.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { FactKey } from "../keys.ts";
import type { OutputFailure, SnapshotFacts } from "../validate-output.ts";
import type { AccessEvent, CardAuthEvent, DeviceRecognition, IpLocation } from "./contract.ts";

/** Facts whose values are records: printed by the server, never given to the model. */
export const SERVER_ONLY_FACT_KEYS = ["access_events", "card_auth_events", "device_recognition"] as const satisfies readonly FactKey[];

/** evidence_processed_v2 types of the institution's technical records (brief 3a): never excerpted for the model. */
export const TECHNICAL_RECORD_EVIDENCE_TYPES = ["RAW_BANK_ACCOUNT_LOGIN_AND_IP_DATA", "CARD_AUTHENTICATION_RECORD"] as const;

/** What replaces a record value in a text given to the model. The model is told what it means. */
export const RECORD_PLACEHOLDER = "[record detail]";

const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
// Full and compressed IPv6 forms; a clock time (one colon) or a time with seconds (two) does not match.
const IPV6 = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![0-9a-f:])|::(?:ffff:)?(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}\b/gi;

function valuesOf<T>(facts: SnapshotFacts, key: FactKey): T[] {
  const value = facts[key]?.value;
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Every record value in the case that must not reach the model, longest first (so a value inside another is not split). */
export function serverOnlyValues(facts: SnapshotFacts, ipLocations: readonly IpLocation[] = []): string[] {
  const out = new Set<string>();
  const add = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v).trim();
    if (s.length >= 3) out.add(s);
  };
  for (const e of valuesOf<AccessEvent>(facts, "access_events")) {
    add(e.deviceRef);
    add(e.deviceLabel);
    add(e.ip);
    add(e.tokenRef);
  }
  for (const e of valuesOf<CardAuthEvent>(facts, "card_auth_events")) {
    add(e.deviceRef);
    add(e.deviceLabel);
    add(e.tokenRef);
    add(e.walletDeviceLabel);
  }
  for (const d of valuesOf<DeviceRecognition>(facts, "device_recognition")) {
    add(d.deviceRef);
    add(d.deviceLabel);
  }
  for (const l of ipLocations) {
    add(l.ip);
    add(l.city);
    add(l.region);
    add(l.organisation);
    add(l.institutionStatedLocation);
    if (l.asn !== null) {
      add(`AS${l.asn}`);
      add(l.asn);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text with every record value and every IP-address shape replaced. */
export function redactServerOnly(text: string, values: readonly string[]): string {
  let out = text;
  for (const v of values) {
    // A number (an ASN) is replaced only as a whole number: never inside a longer number, an amount or a decimal.
    const pattern = /^\d+$/.test(v) ? new RegExp(`(?<!\\d|\\d[.,])${escape(v)}(?!\\d|[.,]\\d)`, "g") : new RegExp(escape(v), "gi");
    out = out.replace(pattern, RECORD_PLACEHOLDER);
  }
  return out.replace(IPV4, RECORD_PLACEHOLDER).replace(IPV6, RECORD_PLACEHOLDER);
}

/** The model's facts without the record facts. */
export function factsForModel(facts: SnapshotFacts): SnapshotFacts {
  const out: SnapshotFacts = {};
  for (const [key, fact] of Object.entries(facts)) {
    if (!(SERVER_ONLY_FACT_KEYS as readonly string[]).includes(key)) out[key as FactKey] = fact;
  }
  return out;
}

export function isTechnicalRecordDocument(evidenceType: string | null | undefined): boolean {
  return (TECHNICAL_RECORD_EVIDENCE_TYPES as readonly string[]).includes(evidenceType ?? "");
}

// ---------------------------------------------------------------------------------------------------------------
// The verdict guard (brief section 4; 4h)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Verdict wording as the pack's own finding. The documents' terms (negligence, gross negligence, recklessness) may be
 * named inside quotation marks; text in quotation marks is not checked.
 */
export const VERDICT_WORDING =
  /\b(?:breach(?:ed|es|ing)?|violat(?:ed|es|ing|ion|ions)|fail(?:ed|s|ing)? to (?:meet|comply|follow|observe|fulfil|fulfill)|did not comply|(?:non-?|not in )complian(?:ce|t)|(?:is|was|are|were|be|being|been) (?:not )?(?:therefore )?(?:fully |partly )?liable|liable for|(?:is|was|are|were|acted|been) (?:grossly )?negligent(?:ly)?|grossly negligent|(?:is|was|are|were|acted|been) reckless(?:ly)?|recklessly|at fault)\b/i;

/** The text with every quotation (straight or curly, single or double) emptied. An apostrophe is not a quotation mark. */
export function withoutQuotations(text: string): string {
  return text
    .replace(/"[^"]*"/g, '""')
    .replace(/“[^”]*”/g, "“”")
    .replace(/‘[^’]*’(?=[\s.,;:)!?]|$)/g, "‘’")
    .replace(/(^|[\s(])'[^']*'(?=[\s.,;:)!?]|$)/g, "$1''");
}

export function verdictFailures(texts: readonly string[]): OutputFailure[] {
  const failures: OutputFailure[] = [];
  for (const text of texts) {
    const match = VERDICT_WORDING.exec(withoutQuotations(text));
    if (match) {
      failures.push({
        check: "forbidden",
        detail: `state what the records and the documents show; FIDReC decides (found "${match[0]}"): ${text.slice(0, 120)}`,
      });
    }
  }
  return failures;
}
