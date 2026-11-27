// A document whose reading stops partway is a failed reading (Elena, 27 Nov 2026). Gemini says why an answer ended in
// finishReason; anything but a normal stop (MAX_TOKENS above all) means the text is incomplete, so it is not stored.
export function assertReadToTheEnd(body: unknown): void {
  const reason = (body as { candidates?: Array<{ finishReason?: string }> } | null)?.candidates?.[0]?.finishReason;
  if (reason && reason !== "STOP") throw new Error(`document_not_read_to_end: ${reason}`);
}
