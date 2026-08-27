# GuideBuoy AI — Design Tokens (v3, "Harbor" system + emotional-state modes)

**Supersedes `design-tokens.md` (v2).** The palette is now the
research-backed **Harbor** system from `design.md` (trauma-informed,
neurodivergent-first), and the system ships in **three user-swappable
design modes matched to emotional state**, selectable at all times from
every screen.

Design intent unchanged and now evidence-anchored: users arrive
emotionally activated — often in fight-or-flight, frequently
neurodivergent (ADHD, AuDHD, autistic) with lower sensory thresholds.
The interface must lower the user's heart rate from the first screen.
Muted > saturated, always. If a colour "pops," it's wrong.

---

## 1. Core palette — "Harbor"

### Brand colours

| Token | Name | Hex | Role |
|---|---|---|---|
| `--gb-primary` | Harbor Teal | `#2E6E6A` | Primary buttons, links, brand anchor, active states |
| `--gb-primary-deep` | Deep Harbor | `#245854` | Hover/active on primary, headings on light tints |
| `--gb-secondary` | Sage | `#3E6B4F` | Secondary emphasis, progress/growth, success-adjacent UI |
| `--gb-accent` | Dusty Blue | `#3D5A80` | Informational elements, legal/formal links, data highlights |
| `--gb-warm` | Lavender Ash | `#7A6F92` | Empathy moments, "we hear you" UI, gentle highlights |

### Backgrounds & surfaces (light)

| Token | Name | Hex | Role |
|---|---|---|---|
| `--gb-bg` | Cream | `#FAF7F2` | App background — warm off-white, never pure white |
| `--gb-surface` | Warm White | `#FDFCFA` | Cards, elevated surfaces |
| `--gb-tint-teal` | Mist Blue | `#E3EBF0` | Info panels, legal/formal callouts, selected rows |
| `--gb-tint-sage` | Sage Mist | `#DCE8DC` | Success panels, completed steps, reassurance blocks |
| `--gb-tint-lavender` | Lavender Mist | `#E6E1F0` | Empathy/support callouts, post-story warmth |
| `--gb-tint-sand` | Sand | `#F0EAE0` | Neutral secondary panels, quote/evidence blocks |

### Text & lines

| Token | Name | Hex | Role |
|---|---|---|---|
| `--gb-text` | Deep Slate | `#2E3A3F` | Body text — soft off-black (10.96:1 on Cream = AAA) |
| `--gb-text-muted` | Slate Muted | `#5C6B70` | Secondary text, captions |
| `--gb-border` | Fog | `#D8DDD8` | Dividers, card borders, input outlines |

### Semantic / status colours (the critical override)

Standard UI red/yellow/green is calibrated for *attention*; GuideBuoy's
is calibrated for *regulated attention*.

| Token | Name | Hex | Role | Replaces |
|---|---|---|---|---|
| `--gb-error` | Muted Terracotta | `#B4552F` | Errors, destructive actions | ⚠ bright red |
| `--gb-error-tint` | Terracotta Mist | `#F3E0D5` | Error panel backgrounds | ⚠ red tints |
| `--gb-warning` | Ochre | `#A8782E` | Deadlines, "attention needed" | ⚠ neon yellow/amber |
| `--gb-warning-tint` | Ochre Mist | `#F3EBDA` | Warning panels | ⚠ yellow tints |
| `--gb-success` | Sage Deep | `#3E6B4F` | Confirmations, completed steps | ⚠ vivid green |
| `--gb-info` | Dusty Blue | `#3D5A80` | Information, tips | ⚠ bright cyan |

Status rules: errors are never red walls — terracotta text on Terracotta
Mist, icon, and a plain-language "here's what to do next." Urgency is
communicated in words and placement ("3 days left — here's your next
step"), never colour aggression, never flashing. Every status pairs
colour + icon (✓ ⓘ ⚠ ✕) + text label.

### Dark mode — "Night Harbor" (orthogonal to the three modes)

| Token | Name | Hex | Role |
|---|---|---|---|
| `--gb-dark-bg` | Night Water | `#1E2A2B` | App background — never pure black |
| `--gb-dark-surface` | Night Surface | `#26383A` | Cards, panels |
| `--gb-dark-text` | Night Cream | `#F5F1EA` | Body text (13.1:1 = AAA) |
| `--gb-dark-primary` | Soft Teal | `#7FB5B2` | Primary actions in dark mode (6.4:1 = AA) |
| `--gb-dark-border` | Night Fog | `#3A4A4C` | Dividers, borders |

### Verified contrast (WCAG)

Deep Slate on Cream 10.96:1 (AAA) · White on Harbor Teal 5.91:1 (AA) ·
White on Deep Harbor 8.08:1 (AAA) · Harbor Teal text on Cream 5.53:1
(AA) · White on Muted Terracotta 4.91:1 (AA) · White on Sage Deep
6.14:1 (AA) · White on Dusty Blue 7.06:1 (AAA) · Deep Slate on any tint
9.1–9.8:1 (AAA) · Night Cream on Night Water 13.12:1 (AAA).
Contrast sweet spot: ≥4.5:1 but **never** pure `#000` on `#FFF`.

---

## 2. The three emotional-state design modes (the v3 headline feature)

The user selects the mode that matches how they feel **right now**. The
selector is **present on every screen at all times** — public pages,
router, workspace, checkout, report hub, error states. One tap, instant
global switch, remembered across sessions, reversible anytime, never
hidden in a settings menu.

| Mode | User-facing label | Emotional state it serves | What changes |
|---|---|---|---|
| **1. Steady** (default) | "I'm okay" | Coping, functional, wants the full product | Full Harbor palette: all tints, empathy lavender, sage progress, Lumi illustrations, gentle motion |
| **2. Quiet** | "Everything feels too much" | Overstimulated, sensory overload, can't take in colour | Near-monochrome calm: all *decorative* tints flatten to Cream/Sand, accents collapse to Harbor Teal only, animations off, illustrations removed. Layout and content density stay **identical** to Steady; error and deadline colours stay semantic (see §6) |
| **3. Grounding** | "I need a moment" | Acute distress, crisis, about to abandon | Screen empties to a single Cream canvas: one Soft Teal breathing circle (4-7-8 rhythm — Soft Teal is the breathing element only, never a button fill on Cream), one line of text, one Harbor Teal button with white text — "Continue when ready" or "Save and exit." No-guilt close, never "Quit." All work is saved underneath and restored on return |

Mapping to `design.md` §5 sensory levels: **Steady = "Standard"**, **Quiet = "Low-Sensory Mode"** (internal name, never user-facing), **Grounding = "Grounding Mode (crisis)"**.

**Mode-switcher component spec:**

- Persistent position: right side of the header on desktop; sticky,
  thumb-reachable header control on mobile (must never collide with the
  single WhatsApp entry point or cover the sticky primary action).
- Presentation: a quiet segmented control or single "How are you
  feeling?" chip that opens three plain-language options — never a
  colour-picker, never technical names ("Low-Sensory Mode" is internal).
- Behaviour: applies instantly without reload or confirmation; persisted
  in localStorage for anonymous users and in the account profile after
  sign-in; announced to screen readers ("Display changed to Quiet mode");
  respects `prefers-reduced-motion` / `prefers-contrast` as starting hints.
- Consistency is safety: the switch is global and total — no screen,
  modal, banner, checkout interstitial, or error state may break mode.
  Palette, layout, and navigation positions stay identical; only sensory
  intensity changes.
- Grounding mode extras: tapping "I need a moment" from any screen
  pauses (never cancels) the current task; the breathing canvas offers
  exactly one way back and one safe exit; colour becomes a conditioned
  calm cue — always the same Soft Teal.
- Google Stitch must therefore deliver **every screen in three visual
  variants** (Steady / Quiet / Grounding), plus the mode-switcher
  component itself with all three states shown.

---

## 3. Typography

| Role | Spec |
|---|---|
| Family | Inter (or equivalent highly legible sans-serif) |
| Display / H1 | 32–40 px mobile, 44–56 px desktop; weight 650; Deep Slate or Deep Harbor; line-height 1.15 |
| H2 | 24–28 px; weight 600 |
| H3 | 18–20 px; weight 600 |
| Body | 16–17 px; weight 400; Deep Slate; line-height 1.6 |
| Small / caption | 14 px; Slate Muted |
| Numerals | Tabular figures for money, dates, case IDs, progress |
| Money format | `SGD 12,400.00` |
| Date format | `29 Mar 2026` |

---

## 4. Shape, spacing, elevation

| Token | Value |
|---|---|
| Card radius | 14 px (12–16 px range; never pill containers) |
| Button / input radius | 10 px |
| Page gutter | 20 px mobile / 32 px desktop |
| Section spacing | 64–96 px desktop, 48 px mobile |
| Card padding | 24–32 px |
| Shadow | Single soft shadow: `0 2px 12px rgba(46,58,63,0.08)` |
| Dividers | 1 px Fog `#D8DDD8` |

---

## 5. Motion

- Gentle and purposeful only: 200–350 ms, ease-out.
- Progress uses step labels ("Reading document → Extracting facts"),
  never fake percentages.
- Quiet mode: all non-essential animation off.
- Grounding mode: only the breathing circle moves (4 s in, 7 s hold,
  8 s out); `prefers-reduced-motion` replaces it with a static
  "Breathe in… hold… breathe out…" text cue.
- No auto-playing animation, flashing badges, or pulsing hot-colour dots
  anywhere, in any mode.

---

## 6. Functional colour coding — what colour means (all modes)

| Context | Steady mode | Quiet mode | Grounding mode |
|---|---|---|---|
| Primary action | Harbor Teal fill, white text | Harbor Teal fill, white text | Single Harbor Teal button, white text (5.91:1 AA) |
| Secondary action | Deep Slate text, Fog border | Same | Hidden |
| Progress / completed | Sage Mist bg, Sage Deep icon | Sand bg, Harbor Teal icon | Hidden |
| Empathy moments | Lavender Mist bg | Sand bg | n/a |
| Legal / formal info | Mist Blue bg, Dusty Blue headings | Sand bg, Deep Slate headings | n/a |
| Errors & validation | Terracotta Mist bg, Muted Terracotta + icon | Same (errors never flatten — clarity is safety) | n/a |
| Deadlines | Ochre Mist bg, Ochre + icon | Same (never flattened) | n/a |

Errors and deadline signals keep their semantic colours in Quiet mode —
flattening them would hide information the user legally needs. Only
decorative and emotional-support colour flattens.

---

## 7. Voice and tone (unchanged, still binding)

Warm, plainspoken, factual, reassuring, never patronising. Singapore
English; explain FIDReC, MAS, IMDA, SPF on first use.
Say: "Tell us what happened in your own words." · "You can change this
later." · "Your payment and case information are safe."
Never say: "You failed validation." · "Invalid case." · "Your claim is
rejected." · "AI has decided…" · raw error codes · "Just upload…"

---

## 8. Lumi mascot usage (updated for modes)

- Primary brand asset: the Lumi buoy render. Its deep-teal hull reads
  naturally into Harbor Teal; the lamp glow may be graded toward
  Soft Teal / Sage for palette harmony.
- Steady mode: full Lumi presence — header mark, avatar, processing
  companion, empty states.
- Quiet mode: Lumi reduced to a simple static line mark; no glow pulse.
- Grounding mode: Lumi absent — nothing on the canvas but breath, one
  line, one button.
- Never depict Lumi alarmed, or users as helpless victims.

---

## 9. Absolute don'ts (all modes, all pages)

- ❌ Bright red, neon orange, bright yellow — anywhere, ever, including
  errors and marketing.
- ❌ Pure black `#000000` or pure white `#FFFFFF` as text/background pairs.
- ❌ More than ~5 hues on one screen (background + text + 1 accent +
  1 status max).
- ❌ Colour-coded urgency escalation (yellow → orange → red).
- ❌ Saturated gradients, glassmorphism over busy imagery, patterned
  backgrounds behind text.
- ❌ Streaks, "you missed a day" counters, red-gamified pressure.
- ❌ Surprise palette shifts between screens — including on mode switch:
  layout must not move, only sensory intensity.

---

## 10. Ready-to-use code

```css
:root {
  /* Brand */
  --gb-primary:        #2E6E6A;
  --gb-primary-deep:   #245854;
  --gb-secondary:      #3E6B4F;
  --gb-accent:         #3D5A80;
  --gb-warm:           #7A6F92;

  /* Surfaces */
  --gb-bg:             #FAF7F2;
  --gb-surface:        #FDFCFA;
  --gb-tint-teal:      #E3EBF0;
  --gb-tint-sage:      #DCE8DC;
  --gb-tint-lavender:  #E6E1F0;
  --gb-tint-sand:      #F0EAE0;

  /* Text & lines */
  --gb-text:           #2E3A3F;
  --gb-text-muted:     #5C6B70;
  --gb-border:         #D8DDD8;

  /* Semantic */
  --gb-error:          #B4552F;
  --gb-error-tint:     #F3E0D5;
  --gb-warning:        #A8782E;
  --gb-warning-tint:   #F3EBDA;
  --gb-success:        #3E6B4F;
  --gb-info:           #3D5A80;
}

[data-theme="dark"] {
  --gb-bg:             #1E2A2B;
  --gb-surface:        #26383A;
  --gb-text:           #F5F1EA;
  --gb-text-muted:     #A8B5B3;
  --gb-primary:        #7FB5B2;
  --gb-primary-deep:   #5E9490;
  --gb-border:         #3A4A4C;
}

/* Quiet mode: collapse decorative colour to near-monochrome */
[data-sensory="quiet"] {
  --gb-tint-lavender:  var(--gb-tint-sand);
  --gb-tint-sage:      var(--gb-tint-sand);
  --gb-tint-teal:      var(--gb-tint-sand);
  --gb-warm:           var(--gb-text-muted);
  /* errors/warnings keep semantic colour — see §6 */
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

*Source: `design.md` (Harbor system v1.0, July 2026), consolidated with
the v3 three-mode spec. Full research citations live in `design.md`.*
