// The switch for the FIDReC pack update (Elena's condition A, 24 Nov 2026). Off unless set to exactly "true" (any case,
// surrounding spaces ignored). Read on the server only (the pack Edge Functions); never a NEXT_PUBLIC_ value. With it
// off, no new section, line or model-prompt change is visible in any pack. scripts/check-env-set.ts reports it as off
// for every environment until Elena decides otherwise.

export const FIDREC_UPDATE_SECTIONS_ENV = "FIDREC_UPDATE_SECTIONS_ENABLED" as const;

export function fidrecUpdateSectionsEnabled(get: (name: string) => string | undefined | null): boolean {
  return (get(FIDREC_UPDATE_SECTIONS_ENV) ?? "").trim().toLowerCase() === "true";
}
