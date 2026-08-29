export type HarborFixtureTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error' | 'inactive'

export interface HarborVisualFixture {
  id: string
  family: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I'
  title: string
  summary: string
  tone: HarborFixtureTone
  automated?: boolean
}

export const HARBOR_VISUAL_FIXTURES = [
  { id: 'A1-home-capture', family: 'A', title: 'Home narrative capture', summary: 'Empty, typed, recorded, restored and offline capture states use the same local-draft owner.', tone: 'neutral' },
  { id: 'A2-product', family: 'A', title: 'Product journey', summary: 'The six-step journey separates free organisation from optional paid outputs.', tone: 'neutral' },
  { id: 'A3-about', family: 'A', title: 'About and responsible use', summary: 'Purpose and limitations appear without certification, endorsement or outcome claims.', tone: 'neutral' },
  { id: 'A4-marketplace', family: 'A', title: 'Planned help categories', summary: 'Clinics, social services and warm handovers are visible but inactive and non-affiliative.', tone: 'inactive' },
  { id: 'A5-resources', family: 'A', title: 'External resource directory', summary: 'Search, categories, no-results recovery and verified external destinations share one directory.', tone: 'neutral' },
  { id: 'A6-faq', family: 'A', title: 'FAQ and contact', summary: 'Searchable answers use claim-safe product, privacy and availability language.', tone: 'neutral' },
  { id: 'A7-sign-in', family: 'A', title: 'Sign in', summary: 'Clerk remains the identity authority. Singpass sign-in is not currently available.', tone: 'inactive' },
  { id: 'A8-sign-up', family: 'A', title: 'Create an account', summary: 'The local story remains separate until authenticated case bootstrap succeeds.', tone: 'neutral' },

  { id: 'B1-story', family: 'B', title: 'Router story', summary: 'The pre-auth story is saved through the canonical router session.', tone: 'neutral' },
  { id: 'B2-classifying', family: 'B', title: 'Classification in progress', summary: 'A slow or failed classification keeps the story and offers safe retry.', tone: 'progress' },
  { id: 'B3-questions', family: 'B', title: 'Focused router question', summary: 'One question is shown at a time with back and unsure choices.', tone: 'neutral' },
  { id: 'B4-bank-first', family: 'B', title: 'Bank-first information', summary: 'Returned classification is presented as information, not a case decision.', tone: 'success' },
  { id: 'B5-telco-imda', family: 'B', title: 'Telecommunications information', summary: 'Official public resources are linked without deciding liability or affiliation.', tone: 'neutral' },
  { id: 'B6-fidrec', family: 'B', title: 'Potential FIDReC pathway', summary: 'The pathway is informational and the receiving organisation decides eligibility.', tone: 'neutral' },
  { id: 'B7-waiting', family: 'B', title: 'Waiting route', summary: 'Record-keeping guidance appears without a fabricated deadline or reminder.', tone: 'warning' },
  { id: 'B8-other', family: 'B', title: 'Other pathway', summary: 'The result offers neutral next-step information and a safe exit.', tone: 'neutral' },
  { id: 'B9-out-of-scope', family: 'B', title: 'Outside current scope', summary: 'The experience states its limits without inventing an alternative service.', tone: 'inactive' },
  { id: 'B10-tracker', family: 'B', title: 'Informational tracker', summary: 'Saved answers can be reviewed; reminders remain inactive without API capability.', tone: 'inactive' },

  { id: 'C1-auth-check', family: 'C', title: 'Authentication check', summary: 'Case bootstrap waits for the provider-owned sign-in state.', tone: 'progress' },
  { id: 'C2-importing', family: 'C', title: 'Importing saved story', summary: 'The canonical bootstrap endpoint is working with the retained local draft.', tone: 'progress' },
  { id: 'C3-success', family: 'C', title: 'Case ready', summary: 'Navigation follows the server-created case identifier.', tone: 'success' },
  { id: 'C4-no-story', family: 'C', title: 'No saved story', summary: 'The user can return home without a false case-created message.', tone: 'neutral' },
  { id: 'C5-expired-story', family: 'C', title: 'Saved story unavailable', summary: 'A missing or expired browser draft receives a clear recovery route.', tone: 'warning' },
  { id: 'C6-offline', family: 'C', title: 'Bootstrap offline', summary: 'The saved story stays available locally while network continuation is paused.', tone: 'warning' },
  { id: 'C7-access-failure', family: 'C', title: 'Bootstrap access recovery', summary: 'Authentication or access failure does not clear the retained story.', tone: 'error' },
  { id: 'C8-server-failure', family: 'C', title: 'Bootstrap retry', summary: 'Server failure keeps the draft and provides retry and safe-exit actions.', tone: 'error' },

  { id: 'D1-story-edit', family: 'D', title: 'Case story editing', summary: 'Server validation errors retain the entered story.', tone: 'neutral' },
  { id: 'D2-upload-active', family: 'D', title: 'Evidence upload', summary: 'Queued and uploading evidence uses limits and accepted types from the upload owner.', tone: 'progress' },
  { id: 'D3-processing-stages', family: 'D', title: 'Evidence processing stages', summary: 'Reading, checking, organising and extracting are stage labels rather than fake percentages.', tone: 'progress' },
  { id: 'D4-evidence-ready', family: 'D', title: 'Evidence ready', summary: 'Authoritative document state unlocks the next available case action.', tone: 'success' },
  { id: 'D5-evidence-recovery', family: 'D', title: 'Evidence recovery', summary: 'Failed, rejected or duplicate files show an accessible replace or retry path.', tone: 'error' },
  { id: 'D6-gap-save', family: 'D', title: 'Question saved', summary: 'Gap answers move from saving to server-confirmed saved state.', tone: 'success' },
  { id: 'D7-gap-recovery', family: 'D', title: 'Question retry', summary: 'An answer error keeps the value and restores focus to recovery.', tone: 'error' },
  { id: 'D8-finalising', family: 'D', title: 'Draft finalising', summary: 'Available panels remain usable while the automated draft is pending.', tone: 'progress', automated: true },
  { id: 'D9-draft-ready-partial', family: 'D', title: 'Draft ready with limitations', summary: 'Ready and partial information remain distinguishable without a case-strength claim.', tone: 'success', automated: true },

  { id: 'E1-blocked', family: 'E', title: 'Checkout prerequisite blocked', summary: 'The missing server prerequisite is shown without a client-side eligibility decision.', tone: 'warning', automated: true },
  { id: 'E2-eligible', family: 'E', title: 'Eligible offer', summary: 'The server-authorised S$18 or S$188 offer shows approved scope before checkout.', tone: 'neutral', automated: true },
  { id: 'E3-redirect', family: 'E', title: 'Starting checkout', summary: 'Duplicate purchase controls lock while the canonical checkout request starts.', tone: 'progress', automated: true },
  { id: 'E4-provider', family: 'E', title: 'Provider handoff', summary: 'Stripe owns payment entry; the application does not infer entitlement.', tone: 'progress', automated: true },
  { id: 'E5-cancelled', family: 'E', title: 'Checkout cancelled', summary: 'The case is preserved and cancellation does not imply failure or purchase.', tone: 'warning', automated: true },
  { id: 'E6-returned', family: 'E', title: 'Checkout returned', summary: 'The application checks server-recorded payment and access status after return.', tone: 'progress', automated: true },
  { id: 'E7-delayed', family: 'E', title: 'Entitlement delayed', summary: 'Access remains pending and repurchase stays locked until server status changes.', tone: 'warning', automated: true },

  { id: 'F1-last-update', family: 'F', title: 'Report status update', summary: 'The latest server-recorded generation state and update time are shown.', tone: 'neutral', automated: true },
  { id: 'F2-reprocessing', family: 'F', title: 'Report reprocessing', summary: 'Reprocessing appears only when the canonical lifecycle reports changed data.', tone: 'progress', automated: true },
  { id: 'F3-analysis', family: 'F', title: 'Report analysis', summary: 'Unknown-duration analysis uses a named stage without fabricated progress.', tone: 'progress', automated: true },
  { id: 'F4-drafting', family: 'F', title: 'Report drafting', summary: 'Automated drafting retains the case and does not promise completion time.', tone: 'progress', automated: true },
  { id: 'F5-background', family: 'F', title: 'Long-running generation', summary: 'Slow background work shows safe status refresh without timing claims.', tone: 'warning', automated: true },
  { id: 'F6-worker-failure', family: 'F', title: 'Generation recovery', summary: 'Failure preserves the case and offers canonical retry or support routes.', tone: 'error', automated: true },
  { id: 'F7-reconnecting', family: 'F', title: 'Realtime reconnecting', summary: 'Offline and reconnecting states refresh authoritative status after connection returns.', tone: 'warning', automated: true },

  { id: 'G1-report-viewer', family: 'G', title: 'Responsive report viewer', summary: 'Version, date, summary, timeline, transactions, evidence and limitations remain readable.', tone: 'success', automated: true },
  { id: 'G2-dashboard-states', family: 'G', title: 'Dashboard loading and recovery', summary: 'Empty, loading and error states keep task-relevant navigation and retry.', tone: 'neutral' },
  { id: 'G3-collaborator-active', family: 'G', title: 'Collaborator invitation states', summary: 'Invite, pending and accepted states come from canonical case access data.', tone: 'neutral' },
  { id: 'G4-collaborator-recovery', family: 'G', title: 'Collaborator access recovery', summary: 'Expired, invalid, revoked and denied access never expose another user’s case.', tone: 'error' },

  { id: 'H1-chooser', family: 'H', title: 'Post-report help chooser', summary: 'Human consultation is not currently available. Planned help stays inactive.', tone: 'inactive' },
  { id: 'H2-form', family: 'H', title: 'Supported contact form', summary: 'Editable contact fields are separated from read-only server case context.', tone: 'neutral' },
  { id: 'H3-submitting', family: 'H', title: 'Contact request submitting', summary: 'Duplicate submission remains locked while the canonical request is pending.', tone: 'progress' },
  { id: 'H4-confirmation', family: 'H', title: 'Contact request receipt', summary: 'A durable response may say “Request received.” without a response-time promise.', tone: 'success' },
  { id: 'H5-error', family: 'H', title: 'Contact request recovery', summary: 'Validation and server errors preserve editable values and restore focus.', tone: 'error' },

  { id: 'I1-auth-access-errors', family: 'I', title: 'Authentication and access errors', summary: 'Expired auth, denied access, not found and server errors reveal no raw infrastructure detail.', tone: 'error' },
  { id: 'I2-empty-offline', family: 'I', title: 'Empty and reconnecting states', summary: 'No-case, document, report, collaborator, result and activity states use safe next actions.', tone: 'warning' },
  { id: 'I3-skeleton', family: 'I', title: 'Loading placeholders', summary: 'Stable skeletons announce loading without presenting fabricated case data.', tone: 'progress' },
] as const satisfies readonly HarborVisualFixture[]

export function findHarborVisualFixture(id: string | undefined) {
  return HARBOR_VISUAL_FIXTURES.find((fixture) => fixture.id === id) ?? HARBOR_VISUAL_FIXTURES[0]
}
