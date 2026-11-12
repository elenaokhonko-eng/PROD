// Normalisers for candidate fact values. Dates become ISO yyyy-mm-dd (Singapore day/month order for numeric dates),
// money keeps its original currency, yes/no answers become yes / no / unsure. Anything that does not parse returns
// null, so the caller can fall back to the model or record the fact as unknown instead of guessing.

import type { Money, YesNoUnsure } from "./keys.ts";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

export function normaliseDate(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s].*)?$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) return isoDate(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
  m = text.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{2,4})$/);
  if (m && MONTHS[m[2]]) return isoDate(fullYear(Number(m[3])), MONTHS[m[2]], Number(m[1]));
  m = text.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m && MONTHS[m[1]]) return isoDate(fullYear(Number(m[3])), MONTHS[m[1]], Number(m[2]));
  return null;
}

const CURRENCY_ALIASES: Array<[RegExp, string]> = [
  [/^(s\$|sgd|sg\$)/i, "SGD"],
  [/^(us\$|usd)/i, "USD"],
  [/^(rm|myr)/i, "MYR"],
  [/^(eur|€)/i, "EUR"],
  [/^(gbp|£)/i, "GBP"],
  [/^\$/, "SGD"],
];

export function normaliseMoney(input: unknown, defaultCurrency = "SGD"): Money | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 ? money(input, defaultCurrency) : null;
  }
  if (typeof input !== "string") return null;
  let text = input.trim().replace(/\s+/g, "");
  let currency: string | null = null;
  for (const [re, code] of CURRENCY_ALIASES) {
    if (re.test(text)) {
      currency = code;
      text = text.replace(re, "");
      break;
    }
  }
  const suffix = text.match(/(sgd|usd|myr|eur|gbp)$/i);
  if (suffix) {
    currency = currency ?? suffix[1].toUpperCase();
    text = text.slice(0, -suffix[1].length);
  }
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, ""));
  return Number.isFinite(amount) ? money(amount, currency ?? defaultCurrency) : null;
}

function money(amount: number, currency: string): Money {
  const rounded = Math.round(amount * 100) / 100;
  return { amount: rounded, currency, amountSgd: currency === "SGD" ? rounded : null };
}

export function normaliseYesNo(input: unknown): YesNoUnsure | null {
  if (typeof input === "boolean") return input ? "yes" : "no";
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase();
  if (["yes", "y", "true"].includes(text)) return "yes";
  if (["no", "n", "false"].includes(text)) return "no";
  if (["not sure", "unsure", "don't know", "dont know", "not known", "unknown"].includes(text)) return "unsure";
  return null;
}

// Fixed-length day arithmetic in UTC dates (no time zone drift).
export function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Calendar months; a day that does not exist in the target month becomes that month's last day (31 Aug + 6 = 28/29 Feb).
export function addMonths(isoDay: string, months: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(fromIsoDay: string, toIsoDay: string): number {
  return Math.round((Date.parse(`${toIsoDay}T00:00:00Z`) - Date.parse(`${fromIsoDay}T00:00:00Z`)) / 86_400_000);
}
