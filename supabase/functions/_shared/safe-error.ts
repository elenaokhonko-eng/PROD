// Errors that Edge Functions log or return carry no case content (free-evaluation hardening item 6, 8 Nov): a
// JSON.parse error quotes the model output it failed on, Postgres "details" quote the failing row, and provider error
// bodies can echo input. Logs and error responses keep the error's name, code, status and a scrubbed message.

/**
 * Removes quoted text, JSON fragments, long numbers (amounts, references, IPv4 addresses), IPv6 and MAC addresses,
 * UUIDs, and runs of 6 or more mixed letters and digits, also after an underscore (dev_8f3a92b1c4), from an error
 * message: device, token and other references. Markers the worker reads (snake_case words) and model names
 * (gpt-6-luna) survive.
 */
export function scrubErrorText(text: string): string {
  return text
    .replace(/\{[\s\S]*\}|\[[\s\S]*\]/g, "{…}")
    .replace(/"[^"]*"|“[^”]*”/g, '"…"')
    .replace(/(?<![0-9a-f])[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?![0-9a-f])/gi, "#")
    .replace(/(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%\w+)?/gi, (m) => (/[0-9a-f]/i.test(m) ? "#" : m))
    .replace(/(?<![a-z0-9])(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{6,}(?![a-z0-9])/gi, "#")
    .replace(/\d[\d,.]{3,}/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface SafeError {
  name: string;
  code: string | null;
  status: number | null;
  message: string;
}

export function safeError(e: unknown): SafeError {
  const err = (e ?? {}) as { name?: unknown; code?: unknown; status?: unknown; message?: unknown };
  const name = typeof err.name === "string" ? err.name : typeof e === "object" ? "ErrorObject" : "UnknownError";
  const code = typeof err.code === "string" || typeof err.code === "number" ? String(err.code) : null;
  const status = typeof err.status === "number" ? err.status : null;
  // A SyntaxError from JSON.parse quotes the text it could not parse: keep only that it was malformed.
  const raw = name === "SyntaxError" ? "malformed JSON" : typeof err.message === "string" ? err.message : String(e);
  return { name, code, status, message: scrubErrorText(raw) };
}

/** One log line or response string: name, code and scrubbed message. */
export function safeErrorText(e: unknown): string {
  const s = safeError(e);
  return `${s.name}${s.code ? ` [${s.code}]` : ""}: ${s.message}`;
}
