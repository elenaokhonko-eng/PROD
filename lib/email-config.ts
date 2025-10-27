const emailFromAddress = process.env.EMAIL_FROM || "info@guidebuoyai.sg"
const emailFromName = process.env.EMAIL_FROM_NAME || "GuideBuoy AI"

export const EMAIL_FROM = `${emailFromName} <${emailFromAddress}>`
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "elena.okhonko@guidebuoyai.sg"
