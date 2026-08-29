# Component and sensory system

Use the Harbor visual language, implemented with Tailwind v4 CSS variables. These names are the production token contract; do not import the legacy `--gb-*` names directly.

## Tokens

```css
@theme inline {
  --color-harbor-canvas: #FAF7F2;
  --color-harbor-surface: #FDFCFA;
  --color-harbor-surface-subtle: #F0EAE0;
  --color-harbor-primary: #2E6E6A;
  --color-harbor-primary-active: #245854;
  --color-harbor-secondary: #3E6B4F;
  --color-harbor-info: #3D5A80;
  --color-harbor-empathy: #7A6F92;
  --color-harbor-text: #2E3A3F;
  --color-harbor-text-muted: #5C6B70;
  --color-harbor-border: #D8DDD8;
  --color-harbor-danger: #B4552F;
  --color-harbor-danger-subtle: #F3E0D5;
  --color-harbor-warning: #A8782E;
  --color-harbor-warning-subtle: #F3EBDA;
  --color-harbor-success: #3E6B4F;
  --font-sans: Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  --radius-control: 0.625rem;
  --radius-card: 0.875rem;
  --radius-dialog: 1rem;
  --shadow-harbor-1: 0 2px 12px rgb(46 58 63 / 8%);
}
```

| Token group | Scale / rule |
|---|---|
| Type | `display` 56/64 650; `h1` 40/48 650; `h2` 28/34 600; `h3` 20/26 600; `body-lg` 17/27 400; `body` 16/24 400; `body-sm` 14/21 400; `label` 12/16 600 (0.05em); numbers use `font-variant-numeric: tabular-nums`. |
| Spacing | 4, 8, 12, 16, 24, 32, 48, 64, 80, 96 px only. Controls: 44 px minimum height; card padding 24 px (16 px at 390); dialog 24 px. |
| Layout | Max shell 1280 px; readable column 720 px; 12-column/32 px gutter at 1440; 8-column/24 px at 768; one column/16 px inset at 390. |
| Elevation | Default flat/bordered; `shadow-harbor-1` only for raised card/dialog. No stronger shadow. |
| Semantics | Primary only for dominant action; success/notice/error always combine icon, label, text and colour. Danger never denotes blame. |
| Focus | `outline: 3px solid var(--color-harbor-info); outline-offset: 2px`; preserve it in every sensory mode. |

## Component contract

| Component | Required behaviour and states |
|---|---|
| Public header/footer | Header: Lumi mark + text, desktop nav, menu button at <1024, sign-in and primary start action. Drawer is focus-trapped, Escape closes, links stack; no horizontal nav scroll. Footer only presents owner-verified organisation/contact/legal links. Legal links may ship only with approved minimum content, a fixed effective date, and revision. |
| Case header/sidebar | Header contains case label/reference, save/network status, entitlement label, settings. Desktop left journey rail; mobile has `Step X of Y` and a drawer. Never expose backend state names. |
| Lumi placement | Public: optional hero cue; authenticated: secondary help affordance near current task. It opens contextual help, never auto-submits/changes form data. The only approved image is in [asset manifest](./source-and-assets.md). |
| Narrative capture | Label, supporting prompt, character guidance if enforced by API, local-restored state, type/record tabs. Recording exposes start, pause, resume, stop, playback, discard and editable transcript. Mic-denied state gives typed fallback. |
| Buttons | Primary, secondary, tertiary/text, destructive. Loading disables duplicate activation and retains label; disabled states include an adjacent reason. All buttons 44×44 px minimum and use `aria-busy` for loading. |
| Fields | Visible label, optional help, required indicator, format hint, inline validation linked with `aria-describedby`. Preserve value on server error; use `aria-invalid` only when invalid. Radio groups for required yes/no. |
| Cards/steps | Card heading, concise body, one dominant action. Stepper labels status as complete/current/blocked/upcoming—not colour alone. |
| Pack cards | Name, S$ price, scope, eligibility/availability, exclusions, automated-output disclosure, and route action. Render only server-catalogue facts. Case-pack purchases and customer-level regeneration access remain distinct; no preselection, recurring-billing implication, guarantees, or unverified policy. |
| Tables/timelines | Use tabular numbers. At 390, transactions become labelled cards or horizontally-contained region with visible scroll affordance; page itself never scrolls horizontally. Timelines stack with date/title/detail. |
| Disclosures | Use native button + `aria-expanded`; summary remains useful when closed. Disclosure cannot hide a required action or error. |
| Dialogs/notices | Dialog has labelled title, initial focus, focus trap, Escape/Close except destructive confirmation where explicit actions are required, and returns focus to trigger. Notice styles: info, success, warning, error, offline. |
| Identity provider option | Provider button has mark/label and a full-width 44 px target. The unavailable Singpass option is a disabled native button, does not open an auth provider, and has visible text “Singpass sign-in is not currently available.” |
| Data-deletion request | Use “Request data deletion.” Explain identity/review steps and lawful security, accounting, and legal-retention exceptions. One deliberate activation creates a durable request and receipt; show “Request received,” the server reference, and returned status. Until the canonical API supplies those durable facts, this is a blocked implementation requirement—not browser-generated UI state. |
| File states | Drop zone/file button; per-file queued, uploading (determinate), processing (step label), ready, failed, rejected, duplicate. Cancel only before server-side processing; retry acts on that file. Accepted types and limits come from the upload API; do not publish a file-type list without verifying it. |
| Progress/errors | Skeleton for page retrieval; spinner for short button work; stage list for unknown-duration generation. Error gives human wording, safe retry, support route where available and optional reference ID. Not-found/global/auth/onboarding recovery surfaces use the same Harbor pattern without exposing infrastructure detail or clearing supported local work. |

## Sensory modes

| Mode | Visual change | Behaviour / accessibility |
|---|---|---|
| **Steady** | Default Harbor tints, optional decorative Lumi/abstract imagery, gentle non-essential transition ≤200 ms. | Information, spacing, control order, content, and contrast stay stable. |
| **Quiet** | Flatten decorative tints to neutral surface; hide `.gb-decorative`; disable non-essential motion. | **No** information, density, action, error, status, or layout is removed or rearranged. Preference persists for the session/device where existing settings support it. |
| **Grounding** | Opens a modal pause above the current screen with calm static/breathing cue and “Return when ready”. | It never submits, navigates, clears, saves, starts/stops recording, changes a mode-dependent form value, or mutates case data. Focus is trapped; Escape and Close/Return restore focus. On 390 it is full-height with a fixed close button; on larger screens it is centred. Respect `prefers-reduced-motion` with a static cue. |

Mode control is a labelled three-button group. Each choice uses `aria-pressed`; announce only the final selected mode in a polite live region. The trigger remains available in both shells but never blocks the primary task.
