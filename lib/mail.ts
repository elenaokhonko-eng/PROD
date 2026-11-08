import nodemailer from "nodemailer"
import { logger } from "@/lib/logger"

let transporter: nodemailer.Transporter | null = null
const log = logger.withContext({ module: "mail" })
const RETRYABLE_SMTP_CODES = new Set([421, 450, 451, 452, 454])
const RETRYABLE_ERROR_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "EAUTH", "EREFUSED"])
const MAX_RETRIES = Number(process.env.SMTP_MAX_RETRIES ?? 3)

export function getMailer() {
  if (transporter) return transporter

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const secure = process.env.SMTP_SECURE === "true"
  const requireTLS = process.env.SMTP_REQUIRE_TLS === "true"
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host) {
    throw new Error("SMTP configuration missing (SMTP_HOST)")
  }

  const auth = user && pass ? { user, pass } : undefined

  console.log("[Mail] Attempting SMTP connection with config:", {
    host,
    port,
    secure,
    requireTLS,
  })

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    auth,
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS ?? 2),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES ?? 50),
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS ?? 15_000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS ?? 15_000),
  })

  return transporter
}

type TransportError = {
  code?: string
  responseCode?: number
  message?: string
  stack?: string
}

function isRetryable(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  const transportError = error as TransportError
  if (transportError.code && RETRYABLE_ERROR_CODES.has(transportError.code)) return true
  if (typeof transportError.responseCode === "number" && RETRYABLE_SMTP_CODES.has(transportError.responseCode)) {
    return true
  }
  return false
}

async function sendWithRetry(
  mailer: nodemailer.Transporter,
  options: nodemailer.SendMailOptions,
  attempt = 1,
): Promise<nodemailer.SentMessageInfo> {
  try {
    const result = await mailer.sendMail(options)
    // Recipients and subjects (an invitation subject names the inviter) stay out of logs (hardening item 6).
    log.info("Email dispatched", {
      recipients: Array.isArray(options.to) ? options.to.length : 1,
      attempt,
      messageId: result.messageId,
    })
    return result
  } catch (error) {
    const transportError = (typeof error === "object" && error !== null ? (error as TransportError) : {}) as TransportError
    const metadata = {
      recipients: Array.isArray(options.to) ? options.to.length : 1,
      attempt,
      code: transportError.code,
      responseCode: transportError.responseCode,
    }

    if (attempt < MAX_RETRIES && isRetryable(error)) {
      const delay = Math.min(5000, 500 * 2 ** (attempt - 1))
      log.warn("Retryable email delivery failure", { ...metadata, retryInMs: delay })
      await new Promise((resolve) => setTimeout(resolve, delay))
      return sendWithRetry(mailer, options, attempt + 1)
    }

    log.error("Email delivery failed", {
      ...metadata,
      error: transportError.message ?? String(error),
      stack: transportError.stack,
    })
    throw error
  }
}

export async function sendMail({
  to,
  subject,
  html,
  from,
  replyTo,
}: {
  to: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
}) {
  // Staging and CI (MAIL_TRANSPORT=sink): mail is recorded, not sent, so test runs do not use up the sandbox's
  // limit (Elena, 8 Nov). Only the release handshake (one message per release SHA, one recipient) reaches real SMTP:
  // one real send per CI run. Production refuses sink mode (check-env-set).
  if (mailSinkCaptures(to, subject)) {
    const messageId = `<sink-${crypto.randomUUID()}@guidebuoy.invalid>`
    log.info("Email captured by sink", { recipients: Array.isArray(to) ? to.length : 1, messageId })
    return { messageId, envelope: { to: Array.isArray(to) ? to : [to] }, accepted: Array.isArray(to) ? to : [to], rejected: [] }
  }
  const mailer = getMailer()
  const defaultFromName = process.env.EMAIL_FROM_NAME || "GuideBuoy AI"
  const defaultFrom = process.env.EMAIL_FROM || "info@guidebuoyai.sg"
  const fromHeader = from || `${defaultFromName} <${defaultFrom}>`

  return sendWithRetry(mailer, { from: fromHeader, to, subject, html, ...(replyTo ? { replyTo } : {}) })
}

export const RELEASE_HANDSHAKE_SUBJECT = /^Harbor release handshake [0-9a-f]{40}$/

/** True when the message goes to the sink instead of SMTP. */
export function mailSinkCaptures(to: string | string[], subject: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.MAIL_TRANSPORT !== "sink") return false
  const recipients = Array.isArray(to) ? to : [to]
  return !(recipients.length === 1 && RELEASE_HANDSHAKE_SUBJECT.test(subject))
}
