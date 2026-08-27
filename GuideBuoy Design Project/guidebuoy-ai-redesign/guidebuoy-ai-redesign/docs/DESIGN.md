---
name: Harbor Steady
colors:
  surface: '#fcf9f4'
  surface-dim: '#dcdad5'
  surface-bright: '#fcf9f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3ee'
  surface-container: '#f0ede9'
  surface-container-high: '#ebe8e3'
  surface-container-highest: '#e5e2dd'
  on-surface: '#1c1c19'
  on-surface-variant: '#3f4947'
  inverse-surface: '#31302d'
  inverse-on-surface: '#f3f0eb'
  outline: '#6f7978'
  outline-variant: '#bfc8c7'
  surface-tint: '#276864'
  primary: '#0d5652'
  on-primary: '#ffffff'
  primary-container: '#2e6e6a'
  on-primary-container: '#aeeee8'
  inverse-primary: '#93d2cd'
  secondary: '#3b684c'
  on-secondary: '#ffffff'
  secondary-container: '#baebc8'
  on-secondary-container: '#3f6c50'
  tertiary: '#304e73'
  on-tertiary: '#ffffff'
  tertiary-container: '#49668d'
  on-tertiary-container: '#d3e3ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#afeee9'
  primary-fixed-dim: '#93d2cd'
  on-primary-fixed: '#00201e'
  on-primary-fixed-variant: '#01504c'
  secondary-fixed: '#bceecb'
  secondary-fixed-dim: '#a1d2b0'
  on-secondary-fixed: '#002110'
  on-secondary-fixed-variant: '#224f35'
  tertiary-fixed: '#d3e3ff'
  tertiary-fixed-dim: '#abc8f4'
  on-tertiary-fixed: '#001c39'
  on-tertiary-fixed-variant: '#2a486d'
  background: '#fcf9f4'
  on-background: '#1c1c19'
  surface-variant: '#e5e2dd'
  primary-deep: '#245854'
  warm-lavender: '#7A6F92'
  surface-white: '#FDFCFA'
  text-slate: '#2E3A3F'
  text-muted: '#5C6B70'
  border-fog: '#D8DDD8'
  error-terracotta: '#B4552F'
  warning-ochre: '#A8782E'
  tint-teal: '#E3EBF0'
  tint-lavender: '#E6E1F0'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: '650'
    lineHeight: '1.15'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
  numeral-tabular:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  page-margin: 32px
  gutter: 32px
  section-gap: 80px
  card-padding: 24px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style

The design system is anchored in a trauma-informed, neurodivergent-first philosophy. It aims to lower the user's heart rate through a "Steady" emotional state—providing a regulated, calm, and nature-inspired environment. The target audience often arrives in a state of high emotional activation; therefore, the UI must prioritize muted tones over saturation and legibility over "pop."

The style is **Corporate / Modern** with a **Minimalist** influence, emphasizing heavy whitespace, balanced typography, and soft, natural color transitions. It avoids aggressive visual cues, such as bright reds or flashing elements, replacing them with grounded, earthy alternatives. The aesthetic is professional yet deeply empathetic, ensuring users feel safe and supported throughout their journey.

## Colors

The palette is built on the "Harbor" system, utilizing natural, desaturated hues to maintain a sense of calm. 

- **Primary (Harbor Teal):** Used for primary actions, active states, and brand anchors.
- **Secondary (Sage):** Represents progress, growth, and success. It is the primary indicator of positive movement.
- **Tertiary (Dusty Blue):** Reserved for formal information, legal callouts, and data highlights.
- **Neutral (Cream):** The foundational background color to avoid the harshness of pure white.

**Semantic Strategy:** Standard high-alert colors are replaced with "Regulated Attention" alternatives. Errors use Muted Terracotta rather than bright red; warnings use Ochre rather than neon yellow. High contrast (minimum 4.5:1) is maintained for accessibility without resorting to pure black (#000) or pure white (#FFF).

## Typography

This design system uses Inter exclusively to ensure maximum legibility across all digital touchpoints. The type scale is generous to prevent visual crowding.

Headlines use a specific weight of 650 for the H1 level to provide a distinct but not overwhelming hierarchy. Body text is set to 1.6 line height to enhance readability for users who may be experiencing cognitive load. Tabular figures must be used for all numerical data, including money (SGD), dates, and case IDs, to ensure vertical alignment in data-heavy views.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop, centered on a 12-column system. It prioritizes vertical rhythm and significant "breathing room" between sections (64px–96px) to reduce sensory overwhelm.

- **Margins & Gutters:** A consistent 32px unit is used for both outer margins and internal gutters to maintain a clean, architectural alignment.
- **Content Width:** While the grid is 12 columns, text-heavy content should be constrained to a maximum of 8 columns (approx. 720px) to maintain optimal line lengths for reading.
- **Reflow:** On desktop, cards and input groups should utilize the grid to stack side-by-side, but never at the expense of white space.

## Elevation & Depth

Visual hierarchy is achieved through **Tonal Layers** and extremely subtle **Ambient Shadows**.

- **Surface Strategy:** The base background is Cream (#FAF7F2). Primary containers (cards, panels) use "Warm White" (#FDFCFA) to create a soft lift.
- **Shadows:** Avoid heavy drops. Use a single, highly diffused shadow: `0 2px 12px rgba(46, 58, 63, 0.08)`. This creates a sense of "resting" on the surface rather than floating far above it.
- **Dividers:** Use 1px "Fog" (#D8DDD8) lines for subtle separation where shadows are unnecessary. 
- **Tints:** Use Mist Blue, Sage Mist, or Lavender Mist to highlight specific functional zones (Info, Success, and Empathy, respectively).

## Shapes

The shape language is "Rounded," reflecting the organic and approachable nature of the brand.

- **Containers:** Standard cards and large surface areas use a 14px radius. 
- **Interactive Elements:** Buttons and input fields use a slightly tighter 10px radius to provide a precise, clickable feel while remaining soft.
- **Consistency:** Never use pill-shaped containers for cards or square (0px) corners for interactive elements, as these create either too much "playfulness" or too much "tension."

## Components

### Buttons
- **Primary:** Harbor Teal fill with White text. Hover state shifts to Deep Harbor.
- **Secondary:** Transparent fill with Deep Slate text and a Fog border.
- **Interaction:** 200–350ms ease-out transitions. No pulsing or "vibrating" animations.

### Cards
- **Style:** Warm White surface, 14px radius, and a single soft shadow. Padding should be generous (24px–32px).
- **Usage:** Used for grouping related content, case details, or AI-generated summaries.

### Input Fields
- **Style:** 10px radius, Fog border. On focus, the border transitions to Harbor Teal with a subtle 2px glow of the same color (low opacity).
- **Validation:** Error states use Terracotta Mist backgrounds with Muted Terracotta text. 

### Chips & Tags
- **Success:** Sage Mist background with Sage Deep text and a checkmark icon.
- **Status:** All status indicators must pair color with a specific icon (✓, ⓘ, ⚠) and a clear text label to assist with color-blindness and clarity.

### The Mode Switcher
A persistent, high-level component (top right of header) that allows users to switch between "Steady," "Quiet," and "Grounding" modes. In the Steady mode, it appears as a clean, segmented control.