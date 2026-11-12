// Errors that Edge Functions log or return carry no case content (free-evaluation hardening item 6, 8 Nov): a
// JSON.parse error quotes the model output it failed on, Postgres "details" quote the failing row, and provider error
// bodies can echo input. Logs and error responses keep the error's name, code, status and a scrubbed message.

/** Removes quoted text, JSON fragments and long numbers (amounts, references) from an error message. */
export function scrubErrorText(text: string): string {
  return text
    .replace(/\{[\s\S]*\}|\[[\s\S]*\]/g, "{…}")
    .replace(/"[^"]*"|“[^”]*”/g, '"…"')
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
