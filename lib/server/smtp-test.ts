// Recipients and subject prefix for the SMTP self-test route (app/api/email/send, Elena, 9 Nov).
export const SMTP_TEST_SUBJECT_PREFIX = "[GuideBuoy SMTP test] "

export function smtpTestRecipients(env: Record<string, string | undefined> = process.env): string[] {
  return [env.HARBOR_SMTP_TEST_RECIPIENT, env.HARBOR_PREVIEW_EMAIL_SINK, env.ADMIN_EMAIL]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value && value.includes("@")))
}
