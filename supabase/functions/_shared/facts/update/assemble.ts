// The FIDReC pack update in one call (Lane 6, assembly): the confirmed snapshot in, the rendered sections, the pinned
// citations and what the model may be told about them out. run_fidrec_pack_v1 calls this with the database provider
// when FIDREC_UPDATE_SECTIONS_ENABLED is on; the end-to-end tests call it with the fake provider.
//
// Plain TypeScript for Deno and Node: relative imports with .ts extensions, no npm imports.

import type { FidrecPromptUpdate } from "../fidrec-pack.ts";
import type { SnapshotFacts } from "../validate-output.ts";
import type { TermRequestSource } from "../rules/institution-terms.ts";
import type { CardAuthEvent, ClauseProvider, IpLocation, IsoDate, SectionResult } from "./contract.ts";
import { serverOnlyValues } from "./model-guard.ts";
import { buildUpdateSections } from "./registry.ts";
import { clauseWords, type RenderedUpdate, renderUpdateSections } from "./render.ts";
import { sectionInputFromSnapshot } from "./section-input.ts";

export interface FidrecUpdate {
  rendered: RenderedUpdate & { generatedOn: IsoDate };
  prompt: FidrecPromptUpdate;
  results: SectionResult[];
}

export async function buildFidrecUpdate(args: {
  facts: SnapshotFacts;
  evidenceIndex: ReadonlyArray<{ id: string; facts: readonly string[] }>;
  institutionCode: string | null;
  ipLocations: readonly IpLocation[];
  provider: ClauseProvider;
  termRequests?: TermRequestSource;
  generatedOn: IsoDate;
  /** R-numbers continue after the clauses the model's duties section was given (R1…Rn). */
  firstClauseNumber: number;
}): Promise<FidrecUpdate> {
  const input = sectionInputFromSnapshot(args);
  const results = await buildUpdateSections(input, { termRequests: args.termRequests });
  const cards = (input.facts.card_auth_events?.value ?? []) as CardAuthEvent[];
  const rendered = renderUpdateSections(results, { firstClauseNumber: args.firstClauseNumber, cards });
  const prompt: FidrecPromptUpdate = {
    sections: rendered.sections.map((s) => ({ id: s.id, title: s.heading })),
    clauses: rendered.citations.map((c) => ({
      id: c.id,
      reference: [clauseWords(c.clauseKey, c.clauseRef), c.documentTitle, c.versionLabel ? `version ${c.versionLabel}` : null].filter(Boolean).join(", "),
    })),
    redact: serverOnlyValues(args.facts, args.ipLocations),
  };
  return { rendered: { ...rendered, generatedOn: args.generatedOn }, prompt, results };
}
