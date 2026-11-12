// Errors logged by the web app carry no case content (hardening item 6): the same rule as the Edge Functions.
export { safeError, safeErrorText, scrubErrorText } from "../../supabase/functions/_shared/safe-error.ts"
