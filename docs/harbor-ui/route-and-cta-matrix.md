# Route-to-screen and CTA matrix

Routes below are current application routes. Do not create browser-only business rules for an unlisted service; use disabled/future treatment until a server route/API contract exists.

## Route map

| Route | Screen family | Authentication / entitlement |
|---|---|---|
| `/` | A1 home narrative capture | Public |
| `/about`, `/product`, `/marketplace`, `/resources`, `/faq`, `/privacy`, `/terms` | A2–A6/A8 public informational pages | Public |
| `/sign-in`, `/sign-up` | A7 authentication | Public; preserve local pending narrative |
| `/router`, `/router/classify`, `/router/questions`, `/router/results`, `/router/path-a2`, `/router/path-e`, `/router/tracker` | B router, results and tracker | Public unless an API action requires sign-in |
| `/onboarding` | C bootstrap | Authenticated; local narrative is optional input |
| `/app`, `/app/case/new` | D entry, intake and upload | Authenticated |
| `/app/case/[id]/dashboard` | D gap/draft, F progress, G report, H help | Case owner/collaborator access; plan state returned by API |
| `/app/case/[id]/checkout` | E checkout/status | Case access; catalogue/eligibility returned by API |
| `/app/settings` | Account/settings | Authenticated |
| `/invite/[token]` | G collaborator invitation | Token plus API-authorised acceptance |
| `/marketplace/volunteers`, `/coming-soon` | Future service / availability | Public; never imply availability |
| `/analytics` | Internal only | Do not surface in consumer navigation |

`/app/signup` and `/app/router` remain internal transition routes. They are not public-nav destinations. The production implementation may compose several states at `/app/case/[id]/dashboard`; the screen-state mapping in [screen specifications](./screen-specifications.md#state-machine-node-mapping) is the binding visual contract.

## CTA matrix

| Visible label | Production action/route | Prerequisite | Failure/disabled behaviour |
|---|---|---|---|
| Start organising for free / Start free | Begin local narrative; then `/sign-up` or `/sign-in` | None | Offline: retain draft and explain sign-in needs connection. |
| Type my story / Record my story | A1 capture mode | Browser support for recording | Mic denial/unavailable: stay in type mode with explanation. |
| Continue to sign in / Create account | Provider flow at `/sign-in` / `/sign-up` | Pending narrative optional | Auth error remains in provider UI; draft is retained locally. |
| Singpass sign-in is not currently available | No action | None | Disabled provider option with that accessible reason; never attempts authentication or implies launch timing. |
| Check my complaint path | `/router` | None | Router offline: disable submit, preserve text. |
| Continue / Next question / Save answer | Router or case gap API action | Current client validation + server accepted state | Keep answer, show inline error/retry. |
| Resume story / Start fresh | Restore or clear *local* pending narrative | Local narrative exists | Start fresh requires confirmation; never clears a created case. |
| Add evidence / Choose files / Use camera | Case evidence upload action | Authenticated case; accepted type | Reject unsupported type before upload; per-file retry/replace. |
| Retry upload / Replace file | Same file action | Failed/rejected file | Does not restart unrelated files. |
| Generate free draft / Refresh draft | Server-defined draft action | Returned readiness: ready document + no blocking gaps | Disabled with next missing requirement; no inferred readiness. |
| Edit story / Add evidence | `/app/case/[id]/dashboard` task state | Case access | Retain report version; show update available after changes. |
| View full report / Back to case | `/app/case/[id]/dashboard` report/case state | Returned report/case availability | Empty/error screen gives safe return. |
| Get full report — S$18 | `/app/case/[id]/checkout` | Case access, API eligibility, catalogue availability | Blocked-prerequisite card or disabled price card with reason. |
| Buy FIDReC case pack — S$188 | Checkout action from report/help surface | Completed report, API entitlement/catalogue availability | Disabled unless server offers it; no manual eligibility. |
| Regeneration subscription (S$8 / S$12) | No public checkout action until lifecycle support is released | Live server catalogue, eligibility enforcement, Stripe configuration, approved lifecycle policy, and tests | Blocked. Do not render an offer, status, upgrade, proration, or entitlement decision from browser state. |
| Continue to payment | Server-created payment redirect | Selected valid server-provided price | Button loading; server error retains selection. |
| Try checkout again | `/app/case/[id]/checkout` | Existing case access | Return to free draft alternative. |
| Check payment status | Refresh entitlement/job state | Returned checkout/session reference | Delayed state; never ask user to repay. |
| Generate my report / No changes—continue | Tier-1 transition action | Paid entitlement and backend allows action | Preserve changes, show current status/retry. |
| Refresh status / Retry status check | Re-read current backend state | Case access | Stays on progress/failure state; no duplicate job in browser. |
| Copy / Print / Download | Report client action or API export | Report/content/action must be available | Disable unavailable export with reason; never fake download. |
| Update report | Backend-supported report update | New case material + returned action permission | Current report remains available. |
| Get help with FIDReC | H form on dashboard | Completed report + case access | Unavailable until report exists; show reason. |
| Submit help request | `POST /api/contact-requests` | Authenticated case; valid required form values | Lock duplicate submit; preserve values on validation/server error. |
| Update request | Same contact-request upsert | Existing returned request + case access | Retain existing confirmation on failure. |
| Request data deletion | Canonical server-side privacy-request action | Authenticated account; durable request/receipt/status API | One deliberate activation creates the request. On confirmed server success, show “Request received,” its reference, returned status, identity/review steps, and lawful-retention exceptions. The current email-only action is insufficient and must not fabricate these facts. |
| View help resources / Request warm handover | No action | None | Inactive “Planned—not currently available through GuideBuoy.” action; do not represent a referral or a live partner relationship. |
| Open WhatsApp | Configured `wa.me` link | None | Label as external service; only one global entry point. |
| Quiet / Steady / A moment | Local sensory display choice | None | Grounding opens non-mutating modal; returns focus. |
| Sign out / Settings | Sign-out or `/app/settings` | Authenticated | Confirm only if unsaved local work could be lost. |
| Accept invitation / Revoke access | Invitation API-backed action | Returned token/role permission | Show invalid/expired/unauthorised state without case disclosure. |

## Future/disabled services

If regeneration UI is later approved, the API must make clear that S$8/month applies only to Tier 1 regeneration and S$12/month to Tier 1/Tier 2 regeneration; neither changes case-pack entitlement. An upgrade can follow only a server-supplied Stripe proration preview and an explicit confirmation. The UI never preselects consent or performs a charge.

- Volunteer marketplace; SAL-linked clinic, social-service, and warm-handover services; reminders/notifications; collaborator permissions beyond supported APIs; S$8/S$12 regeneration offers; specialist appointments; cancellation/refund flows; export; and human review are **future/disabled** unless the applicable API/catalogue/policy is present. A privacy-request control may be enabled only when its durable request/receipt/status API is present; it is never an automatic deletion function.
- Future cards use `aria-disabled="true"`, the exact adjacent reason “Planned—not currently available through GuideBuoy.”, and no payment/navigation side effect.
- Global header/footer links are limited to routes and owner-verified destinations in this matrix; do not add social, regulator, partner, or security-report links without URLs and owner approval.
