/* GuideBuoy AI — Tailwind config (CDN play + exportable for Next.js build)
   Colors map to CSS custom properties from tokens.css so the emotional-state
   modes (Steady / Quiet / Grounding) and Night Harbor theme work by simply
   switching <html data-sensory> / <html data-theme> — no class rewrites.
   For the production Next.js app, mirror this object into tailwind.config.ts
   and keep tokens.css as the single source of truth. */

tailwind.config = {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        /* Brand (variable-driven) */
        "primary":            "var(--gb-primary)",
        "primary-deep":       "var(--gb-primary-deep)",
        "on-primary":         "#ffffff",
        "secondary":          "var(--gb-secondary)",
        "accent":             "var(--gb-accent)",
        "warm-lavender":      "var(--gb-warm)",

        /* Surfaces */
        "surface":            "var(--gb-bg)",
        "surface-white":      "var(--gb-surface)",
        "tint-teal":          "var(--gb-tint-teal)",
        "tint-sage":          "var(--gb-tint-sage)",
        "tint-lavender":      "var(--gb-tint-lavender)",
        "tint-sand":          "var(--gb-tint-sand)",

        /* Text & lines */
        "text-slate":         "var(--gb-text)",
        "text-muted":         "var(--gb-text-muted)",
        "border-fog":         "var(--gb-border)",
        "on-surface-variant": "var(--gb-text-nav)",

        /* Semantic (regulated attention) */
        "error-terracotta":   "var(--gb-error)",
        "error-mist":         "var(--gb-error-tint)",
        "warning-ochre":      "var(--gb-warning)",
        "warning-mist":       "var(--gb-warning-tint)",
        "success-sage":       "var(--gb-success)",
        "info":               "var(--gb-info)"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      },
      fontSize: {
        "headline-lg":     ["56px", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "650" }],
        "headline-md":     ["28px", { lineHeight: "1.2",  fontWeight: "600" }],
        "headline-sm":     ["20px", { lineHeight: "1.3",  fontWeight: "600" }],
        "body-lg":         ["17px", { lineHeight: "1.6",  fontWeight: "400" }],
        "body-sm":         ["14px", { lineHeight: "1.5",  fontWeight: "400" }],
        "label-caps":      ["12px", { lineHeight: "1",    letterSpacing: "0.05em", fontWeight: "600" }],
        "numeral-tabular": ["16px", { lineHeight: "1",    fontWeight: "400" }]
      },
      spacing: {
        "stack-sm":     "8px",
        "stack-md":     "16px",
        "stack-lg":     "24px",
        "gutter":       "32px",
        "page-margin":  "32px",
        "card-padding": "24px",
        "section-gap":  "80px"
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.625rem",  /* 10px — buttons, inputs */
        xl: "0.875rem",  /* 14px — cards */
        full: "9999px"
      },
      boxShadow: {
        ambient: "0 2px 12px rgba(46, 58, 63, 0.08)"
      }
    }
  }
};
