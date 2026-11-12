# Regulatory knowledge audit (8 November 2026): report before fixes

Elena's request: audit the regulatory corpus and the rules config, report first, fix on approval. Read-only queries on
staging; counts and metadata only. The production project has no regulatory rows yet: the reference tables are
copied at G4 (brief B), so whatever is fixed here is what production receives.

## 1. Corpus inventory (staging `regulatory_documents` and `regulatory_clauses`)

| Document (key) | Regulator | Version / issued / effective | Ingested | Clauses | Clauses with embeddings |
|---|---|---|---|---|---|
| ABS Code of Practice for Banks – Credit Cards | ABS | "Last revised: 2 July 2020" / 2020-07-02 / 2009-11-01 | 2026-04-19 | 17 | **0** |
| ABS media release, enhanced safeguards | ABS | 3 Oct 2025 / 2025-10-15 | 2026-04-19 | 12 | **0** |
| MAS anti-scam measures for MPI e-wallets | MAS | MAS/PD/2024/10/04 / 2024-10-25 / — | 2025-12-10 | 21 | **0** |
| MAS E-Payments User Protection Guidelines | MAS | no version string / issue 2018-09-28 / **effective 2024-12-16** | 2025-12-10 | 10 | **0** |
| MAS Notice FSM-N05 (technology risk) | MAS | 2024-05-09 / 2024-05-10 | 2026-04-19 | 11 | **0** |
| MAS Notice FSM-N06 (technology risk) | MAS | 2024-05-09 / 2024-05-10 | 2025-12-10 | 23 | 13 |
| MAS Notice FMS-N08 (cyber hygiene; key misspelt "FMS") | MAS | 2024-05-09 / 2024-05-10 | 2025-12-10 | 12 | 12 |
| MAS Notice FSM-N13 (cyber hygiene) | MAS | 2024-05-09 / 2024-05-10 | 2025-12-10 | 7 | 7 |
| MAS Notice FSM-N14 (cyber hygiene) | MAS | 2024-05-09 / 2024-05-10 | 2025-12-10 | 18 | 18 |
| MAS SRF Guidelines | MAS | no version string / 2024-10-24 / 2024-12-16 | 2025-12-07 | 44 | **0** |

Totals: 10 documents, 175 clauses, **50 with embeddings** (1,536 dimensions; the embedding model is not recorded, the
backfill function uses `text-embedding-3-small`). Document `embedding` is empty for all 10. `source` holds only "MAS"
or "ABS": **no source URL is recorded for any document**. `full_text` is 99–382 characters per document: the text
lives in the clauses, not the document rows.

**Flags**

- **Not retrievable:** the SRF Guidelines, the EUPG, the ABS card code, the MPI e-wallet measures and the ABS release
  have no clause embeddings, so vector search (`match_regulatory_clauses_threshold`) can never return them. Only the
  four technology and cyber-hygiene notices can be retrieved.
- **EUPG version:** effective 16 Dec 2024 is recorded, but there is no version string and the issue date is the 2018
  original. With 10 clauses it is a partial extract; whether it is the 16 Dec 2024 text must be checked clause by
  clause against the MAS PDF before it is trusted. Paragraphs effective only from 16 June 2025 are not marked.
- **Missing:** FIDReC Terms of Reference v2.2 (it is encoded in `rules/fidrec.ts` instead, with clause citations);
  nothing on chargebacks beyond the ABS card code.
- **No superseded document found** (the 5 Sep 2020 EUPG is not present), but nothing in the schema marks a version as
  superseded, so retrieval could not filter one out if it were added.

## 2. Who uses what

| Step | Stage | Regulatory source |
|---|---|---|
| Free evaluation, "How the rules may apply" | 1 | **Rules config only** (`supabase/functions/_shared/facts/rules/srf.ts`, `rules/fidrec.ts`). The model writes only the summary and may not give an SRF, IMDA or telco verdict (checked by `forbidden`). No RAG. |
| Fact extraction, reconciliation, summary | 1 | None. |
| Tier 1 decision (`run_case_decision_v1`) | 2 (paid, off) | RAG: `match_regulatory_clauses_threshold` and direct clause queries. |
| FIDReC pack themes (`retrieve-theme-regulatory-clauses.ts`) | 2 (paid, off) | RAG: same RPC. |

So stage 1 does not quote RAG text as a verdict. The RAG gaps above affect the paid stages.

## 3. What the rules config says today (stage 1, user-facing)

- **Bank account and e-wallet payments:** SRF scope from the confirmed facts, then the EUPG for unauthorised losses
  outside the SRF.
- **Card payments: incorrect.** The text says card transactions "are assessed under the MAS E-Payments User Protection
  Guidelines (EUPG)". The EUPG excludes cards from its liability rules (para 1.2 fn 3, 5.1); the card regime is the
  ABS Code of Practice for Banks – Credit Cards (S$100 cap if not fraudulent or grossly negligent and reported
  promptly; authenticating a fraudulent 3DS prompt can count as negligent) plus the card scheme's chargeback. Only
  some EUPG bank duties apply to cards (alerts, kill switch).
- No EUPG S$1,000 rule, 21/45-business-day investigation deadline, 30-day reporting or police-report duty is stated.
- FIDReC: corrected tonight to the S$50 individual fee (Annex 1, 6.6).

## 4. Proposed fixes (for approval)

1. **Card wording now (stage 1):** replace the card portion's EUPG sentence with the ABS card code and chargeback, and
   say which EUPG duties still apply to cards. Clause citations from the ABS code and the EUPG PDF.
2. **Rules config, three regimes with citations and effective dates:** ABS card code (cap and its conditions, 3DS,
   chargeback); EUPG (2.1 protected account, 1.2/5.1 card exclusion, 5.2–5.6 liability, 3.14, 3.19–3.20, 4.19–4.28);
   SRF (scope, waterfall, card exclusion, telco to IMDA). Precedence per portion: account + digital phishing → SRF,
   then EUPG as fallback and procedure; account + other unauthorised → EUPG; cards → ABS code + chargeback, EUPG duties
   only.
3. **Procedural checks** from the confirmed facts and dates (EUPG 4.19–4.28 for the bank; 3.14, 3.19–3.20 for the
   person), neutral wording.
4. **Corpus:** embed every clause (backfill, about 125 clauses, cost under US$0.01); add `source_url`, `version` and a
   superseded flag (this is a schema change: stage 2, or approve it for stage 1); load the full EUPG 16 Dec 2024 text
   and the FIDReC ToR v2.2; correct the "FMS-N08" key.
5. **Retrieval tests:** a golden set of at least 15 questions with expected document and clause; CI fails on a
   superseded version or a missing framework.
6. Re-run Elena's case and the corpus after 1–3.

Items 1–3 change stage 1 output and can be done without a schema change; item 4's metadata columns need a migration.
