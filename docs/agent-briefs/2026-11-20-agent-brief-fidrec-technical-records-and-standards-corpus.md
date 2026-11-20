# Agent brief: FIDReC pack — technical evidence, versioned standards corpus, and server-written comparisons

Version 2, 20 November 2026. Written by Claude (chat session) for Elena and the Claude Code agent.
Read against `main` @ 2733f13 and `feat/fidrec-pack-2026-11` @ d5b8338. Nothing in this brief is implemented yet.

**How to use this brief.** Work the phases in order. Each phase ends with a gate. Schema migrations run on staging only after Elena approves them. Follow `CLAUDE.md`: no real case data in the repo, fixtures are synthetic, report IDs and counts only.

---

## 0. Decisions Elena has made (20 November)

1. The pack takes in the institution's own technical records as evidence. Two document types: **access records** (logins, devices, IP addresses, token activation, alerts) and **card authentication records**.
2. Technical evidence is compared, by the server, against time-stamped duties in the EUPG, the SRF Guidelines and the ABS card code, **and against MAS notices** to banks and other financial institutions, and against industry practice.
3. Every comparison uses one fixed form: the fact from the evidence; what the document expects of the institution; the two set side by side. **No sentence says a duty was breached or met. We speak in facts.**
4. **IP addresses are looked up** for location and network owner (this reverses version 1 of this brief).
5. Card cases: the pack sets out the conditions under which the card scheme's rules let the issuer raise a dispute, whether the record shows those conditions, whether the cardholder asked, and what the institution did.
6. A server-written **customer-conduct comparison**: what the EUPG, the SRF, the ABS card code and the institution's own terms each call negligence, gross negligence or recklessness, set beside the conduct the evidence shows and the label the institution used.
7. **Every document in the corpus is versioned.** For contracts the version that counts is the one in force on the payment date.
8. All of the above is to be enabled. The phases below are a build order, not a choice of scope.
9. Bank pack (S$18): when no technical record is uploaded, its request list asks the institution for one.

---

## 1. Findings

### 1.1 What is chunked today

Not re-queried: the chat session cannot reach the staging database. The last record is `docs/release/regulatory-corpus-audit-2026-11-08.md`; no migration or commit since then touches `regulatory_documents` or `regulatory_clauses`. Phase 0 re-runs it.

As of 8 November (staging): 10 documents, 175 clauses, 50 with embeddings.

| Document | Clauses | Embedded |
|---|---|---|
| MAS SRF Guidelines | 44 | 0 |
| MAS E-Payments User Protection Guidelines (partial extract) | 10 | 0 |
| ABS Code of Practice for Banks – Credit Cards | 17 | 0 |
| ABS media release, Oct 2025 | 12 | 0 |
| MAS anti-scam measures for MPI e-wallets | 21 | 0 |
| MAS Notice FSM-N05 | 11 | 0 |
| MAS Notice FSM-N06 | 23 | 13 |
| MAS Notice FSM-N08 (key misspelt "FMS-N08") | 12 | 12 |
| MAS Notice FSM-N13 | 7 | 7 |
| MAS Notice FSM-N14 | 18 | 18 |

No bank terms and no card scheme rules are held.

### 1.2 Notice designations (MAS cyber-security page, since 10 May 2024)

| Institution type | Technology Risk Management | Cyber Hygiene |
|---|---|---|
| Banks | FSM-N05 (was 644) | FSM-N06 (was 655) |
| Credit card or charge card licensees (non-bank) | FSM-N07 (was 644A) — not held | FSM-N08 (was 655A) |
| Designated payment system operators and settlement institutions, DPT service providers | FSM-N13 (was PSN05) | FSM-N14 (was PSN06) |
| Merchant banks | FSM-N11 | FSM-N12 |
| Finance companies | FSM-N09 | FSM-N10 |

The audit doc's labels for N06 and N13 are wrong; correct them in Phase 1.

### 1.3 What the notices say that a single case can be set against

Read on 20 November:

- **FSM-N06 (banks, cyber hygiene)** paras 4.1–4.6: administrative accounts, patches, security standards, network perimeter, malware protection, multi-factor authentication. Para 4.6 requires MFA for (a) administrative accounts on critical systems and (b) accounts on any system *the bank uses* to access customer information through the internet. On its wording this covers the bank's own accounts, not a customer logging in to online banking. **Do not build a customer-login check on 4.6 unless Elena's lawyer confirms a wider reading.**
- **FSM-N07 (card licensees, technology risk)** paras 4–9: critical systems; availability (unscheduled downtime of a critical system not above 4 hours in 12 months); recovery time objective of 4 hours; notify MAS within 1 hour of discovering a relevant incident; root-cause report within 14 days; **para 9: implement IT controls to protect customer information from unauthorised access or disclosure.** FSM-N05 for banks follows the same structure; confirm its paragraph numbers from the FSM-N05 text at ingestion.
- The clause closest to "protect the account against unauthorised login" is therefore the **customer-information clause of the technology-risk notice** (para 9 in FSM-N07), and after it the MAS Guidelines on Technology Risk Management (guidelines, not a notice). It is a duty to have controls; it is not worded as a promise that no unauthorised access occurs. The institution-side argument (controls existed and operated: credentials and a one-time code were used) must appear beside it.

### 1.4 What each consumer-facing document says about customer fault

| Document | Term it uses | Defined? | Effect |
|---|---|---|---|
| EUPG (16 Dec 2024) | **Recklessness** (5.2, footnote 20). "Gross negligence" does not appear. "Negligence" appears once, about the institution (5.5(a)) | Yes, by example: footnote 20 lists access codes kept where others can easily reach them; knowingly sharing codes; ignoring alerts or warnings; opening accounts on a third party's instructions without reasonable basis; keeping unverified sideloaded apps; an easily guessed code where the institution warned against it. Recklessness includes deliberately not following Section 3 | Recklessness as the *primary cause* → account holder bears the actual loss up to the agreed limits (5.2). Any failure to follow a Section 3 duty → the first-S$1,000 protection for third-party loss falls away (5.6). Loss caused by the institution's fraud, negligence or non-compliance with Section 4 → account holder not liable (5.4–5.5) |
| SRF Guidelines / MAS–IMDA response | **No customer-fault test.** | — | Loss follows the waterfall on the institution's and the telco's duties only. Outside the SRF, institutions consider "whether the victim acted responsibly" (response para 1.2(b)) |
| ABS Code of Practice for Banks – Credit Cards (rev. 2 Jul 2020) | **Gross negligence** (5(a), 5(b), 5(c), 6) | **No.** No definition and no examples. Para 4 gives card and PIN security advice but does not say that not following it is gross negligence. The issuer "finds" it (5(b), 5(c)) | No fraud, no gross negligence, reported as soon as reasonably practicable → S$100 cap before the report (5(a)); card details used without the card being stolen, or unauthorised PIN transactions → not liable (6). Fraud or gross negligence → 100% (5(b)) |
| The institution's own terms | Varies | Varies | Phase 6 |

Two further points for the pack's standing text:
- The ABS card code **does** allocate card losses (the S$100 cap, the 100% rule). It is an industry code (a sub-code of the Code of Consumer Banking Practice), not legislation and not an MAS instrument.
- MAS's written reply of 7 January 2025 says that unwittingly authenticating a fraudulent 3-D Secure payment is treated as *negligence* and the cap does not apply; the code's own word is *gross* negligence. A FIDReC case study records that banks have found gross negligence where a wallet with a card was left unattended in an unsecured place.

### 1.5 Card scheme rules (Visa public edition dated 13 April 2024; re-check in the current edition)

- 1.1.1.6: the rules govern Visa and its members and give no rights to third parties.
- 11.1.2 (ID 0030208): the issuer **must resolve cardholder disputes** under the rules, extending the protections of applicable law and its customary practice; it must not process invalid disputes.
- Dispute condition 10.4, card-absent fraud (11.7.5): the issuer **may** dispute where the cardholder denies authorising or taking part in the transaction; before disputing it **must report the fraud to Visa**; it provides a certification of the cardholder's denial; time limit **120 calendar days from the transaction processing date**. Invalid, among others: an e-commerce payment authenticated through Visa Secure (ECI 5 with a CAVV in the authorisation); an authenticated token payment where cardholder verification was approved.
- 10.3, key-entered card-present fraud (11.7.4): same permission, same reporting precondition, same 120 days.
- 10.6.1.6 (Asia-Pacific): an issuer found non-compliant with fraud reporting after an on-site review, and not remedied, cannot raise fraud disputes.
- Nothing read obliges an issuer to raise a dispute when a cardholder asks.

The Mastercard Chargeback Guide copy found online was the 2018 edition. Load the current one before writing any Mastercard check.

### 1.6 Code facts

- `fidrec_pack_v1` (`_shared/facts/fidrec-pack.ts`, `run_fidrec_pack_v1`) reads no corpus table. Rules come from `rules/srf.ts` and `rules/fidrec.ts`, whose `cite` fields are free text.
- `DOCUMENT_TYPES` has no technical-record type; `keys.ts` has no fact for devices, logins, tokens, alerts or card authentication.
- `regulatory_*` tables and the match functions are granted ALL to `anon` in the baseline schema.

---

## 2. How fixed rules and the corpus work together

Elena's question: how does the pack compare a case with the regulations if it relies on coded rules and not on the RAG?

It uses both, each for what it is good at, joined by one clause registry.

- **The corpus is the library.** It holds the exact text, version, effective dates and source of every clause. It is the only place clause text lives.
- **Rules are the comparison.** Anything that can be decided from facts — hours between two timestamps, days to a deadline, whether an alert was recorded — is computed by code. The same facts give the same output every time and each rule has a test at its boundary.
- **The join:** every rule cites a `clause_key` (for example `mas.eupg/4.7`). At run time the server loads that clause, in the version in force on the relevant date, and prints its reference, version and link beside the computed result. A build-time test fails if any rule cites a clause the corpus does not hold. `rules/srf.ts` and `rules/fidrec.ts` move from free-text cites to `clause_key`.
- **Retrieval is for what cannot be coded in advance:** which clauses of this bank's terms, in this version, speak to this case; which sections of a 900-page scheme rulebook. Retrieval is filtered by institution, date, instrument and layer before any similarity ranking.
- **Tagged clauses bridge the two.** At ingestion each contract clause gets tags (`definition_gross_negligence`, `customer_security_duty`, `liability_unauthorised`, `notification_deadline`, `dispute_chargeback`, `conclusive_evidence`, `bank_may_block`). A rule can then ask for "this institution's definition of gross negligence in force on 3 March 2025" by tag and date, which is exact, not by similarity, which is approximate.
- **What the model does:** it writes the summary, each side's position and the arguments, citing evidence IDs (E1…) and clause IDs (R1…) that the server gave it. It does not decide whether a duty was met, and it does not write any comparison section.

---

## 3. Versioning

### 3.1 Today

There is none. `regulatory_documents` holds one row per document with a free-text `version`, an `issue_date` and an `effective_date`. There is no end date, no source URL, no stored copy, no hash and no link between an old and a new version. Clauses carry no version. The match functions do not look at dates. If a revised EUPG were loaded, old and new clauses would be retrieved together with nothing to tell them apart.

### 3.2 Target design

This is reference-data versioning: effective-dated, immutable versions (slowly changing dimension type 2) with two time axes — when a version was in force, and when we recorded it.

```
standard_documents            one row per document identity
  id, document_key            e.g. mas.eupg, abs.card_code, dbs.card_agreement, visa.core_rules
  publisher, binding_level    guideline | notice | industry_code | announcement | contract | scheme_rule | forum_rules
  applies_to[]                bank | card_issuer | payment_service_provider | telco
  instrument_scope[]          account_transfer | sg_card | ewallet
  institution                 null for regulators; institution name for contracts
  card_scheme                 null | visa | mastercard
  canonical_url

standard_document_versions    one row per version; never updated except to close effective_to and set status
  id, document_id, version_label
  effective_from, effective_to          when it was in force (null end = current)
  issued_on, retrieved_at               when published; when we fetched it
  source_url, snapshot_path             the exact file fetched, kept in a private bucket
  content_sha256
  provenance                  publisher_site | web_archive | provided_by_user | provided_by_institution
  supersedes_version_id
  status                      draft | verified | withdrawn
  verified_by, verified_at

standard_clauses              one row per clause per version
  id, version_id
  clause_key                  stable across versions, e.g. mas.eupg/4.7
  clause_ref, heading_path, text_content, text_sha256
  tags[]
  effective_from_override     for paragraphs that start later than the document (EUPG paras from 16 Jun 2025)
  embedding, embedding_model
```

Migrate the existing 10 documents into this shape (one version each); keep the old tables and RPCs until the old pipeline is retired.

**Rules**

1. **As-of retrieval.** `match_standards_v1(query_embedding, p_on_date, p_layers, p_applies_to, p_instrument_scope, p_institution, p_card_scheme, match_count, similarity_threshold)` filters `status = 'verified' and effective_from <= p_on_date and (effective_to is null or effective_to > p_on_date)` before ranking. `get_clause_as_of(clause_key, p_on_date)` and `get_clauses_by_tag(tag, institution, p_on_date)` return exact rows for the rules.
2. **Which date.** Duties about a payment use that payment's date. Reporting and investigation duties use the report date. A case that spans a version change gets each version, labelled with the payments it applies to.
3. **Immutable.** A correction is a new row. Nothing overwrites text that a pack has cited.
4. **Pinned citations.** Each report stores the clause IDs and `text_sha256` it cited. Re-opening the report prints the same text. Regenerating after a corpus change is a new report version and says so.
5. **Change detection.** A scheduled job re-fetches each `source_url` monthly and compares `content_sha256`. A change creates a `draft` version with a clause-by-clause diff on `clause_key`. A person sets `effective_from` (banks publish it in a notice of change), marks it `verified`, and the previous version's `effective_to` is closed. Check whether `supabase/functions/url_catalogue` can carry the fetch.
6. **Historic versions.** A bank's site shows only its current terms. Sources for earlier ones, in order: the bank's notice-of-change pages; a web archive copy (`provenance = web_archive`, with the capture date); the complainant's own copy; a request to the institution. Where the version in force on the payment date is not held, the pack says so and shows the nearest version with its dates; it never presents a later version as if it applied.
7. **Tests.** A payment dated before a version's `effective_from` never retrieves it. A case against one institution never retrieves another's contract. Every `clause_key` cited by a rule resolves.

---

## 4. Standing of each layer, and the one comparison form

| Layer | Source | Standing sentence printed above the group |
|---|---|---|
| 1 | SRF Guidelines; EUPG | "MAS guidelines that set out the duties of institutions and account holders and how losses are shared." |
| 2 | MAS notices (FSM-N05/N06 banks; N07/N08 card licensees; N13/N14 payment-system licensees); MAS circular on MPI anti-scam measures; TRM Guidelines | "MAS notices set duties the institution owes to MAS. This section sets the institution's records beside those duties. It does not say whether a duty was met." |
| 3 | ABS card code; MAS–ABS announced measures | "An industry code and announced industry measures. They are not legislation." |
| 4 | The institution's own terms | "The institution's own terms, in the version in force on the date shown." |
| 5 | Visa / Mastercard rules | "Card scheme rules are an agreement between the card scheme and the card issuer. The cardholder is not a party to them. They are shown here as the process available to the issuer." |

**The comparison form (all layers, server-written):**

> **Record:** [fact from the evidence, with its time] (E4).
> **Expected:** Under [document, paragraph, version], [the institution type] is expected to [clause, in the corpus's words or a fixed short paraphrase] (R3).
> **Side by side:** [one of three fixed endings]

Endings, chosen by code:
- `differs` — "The document expects [X]. The record shows [Y]."
- `matches` — "The record shows [X], as the document expects."
- `not_shown` — "The records provided do not show whether [X]."

The words breach, breached, violated, failed, non-compliant, liable, negligent (as the pack's own finding) and their variants are added to the `forbidden` patterns for every comparison section, as `SRF_VERDICT` is today. Quoting the institution's own words inside quotation marks with an evidence ID is allowed.

---

## 5. Phases

### Phase 0 — Re-run the corpus audit (read-only)

```sql
select d.document_key, d.document_title, d.regulator, d.version, d.issue_date, d.effective_date,
       count(c.id) as clauses, count(c.embedding) as clauses_embedded
from public.regulatory_documents d
left join public.regulatory_clauses c on c.document_id = d.id
group by 1,2,3,4,5,6 order by d.regulator, d.document_title;
```

Append the result to the audit doc as a dated section. **Gate:** Elena sees the counts.

### Phase 1 — Versioned corpus and repairs

1. Migration for section 3.2; migrate the 10 documents; correct the notice labels and the `FMS-N08` key.
2. Embed every clause; record `embedding_model`.
3. Replace the 10-clause EUPG extract with the full 16 December 2024 text, paragraph by paragraph, with `effective_from_override` on paragraphs that start on 16 June 2025.
4. The three RPCs in 3.2.
5. Grants: read for `authenticated`, nothing for `anon`, writes for `service_role`.
6. Move `rules/srf.ts` and `rules/fidrec.ts` cites to `clause_key`; add the build-time resolution test.

**Gate:** migration approved; tests in 3.2 rule 7 pass.

### Phase 2 — Regulatory and industry sources

Each loaded from the publisher's own site with `source_url`, snapshot and hash.

| Add | Notes |
|---|---|
| SRF Guidelines, full text, checked against the MAS PDF | Include the five institution duties. Take the fraud-surveillance thresholds from the text; the MAS–IMDA response gives the duty (block until confirmed, or notify and hold for 24 hours) and a six-month transition but no figures |
| MAS–IMDA response to consultation on the SRF | Paras 1.2(b), 3.4–3.6, 4.6–4.7, 5.6–5.7, 6.7–6.11, 8.3–8.4 |
| MAS Notice FSM-N05 and FSM-N06 (verify existing clauses), FSM-N07, FSM-N08 | Para numbers from the text |
| MAS Guidelines on Technology Risk Management (Jan 2021) | Online financial services and fraud monitoring sections first |
| MAS–ABS media releases of 19 Jan 2022, 2 Jun 2022, 9 Jul 2024, 18 Sep 2024 | `binding_level = announcement` |
| ABS Code of Practice for Banks – Credit Cards, rev. 2 Jul 2020 (verify existing 17 clauses) | Paras 4, 5(a)–(e), 6, 10, 11 |
| MAS written replies: 7 Jan 2025 (card fraud), 3 Feb 2026 (SRF and fraud surveillance) | `binding_level = announcement`; used only as stated positions |
| FIDReC Terms of Reference, current version | `forum_rules` |

### Phase 3 — Technical evidence

**3a. Two document types** added to `DOCUMENT_TYPES`, `DOCUMENT_FACTS`, `DOCUMENT_LABELS`:

| Type | Label | What it is |
|---|---|---|
| `bank_access_record` | "the institution's record of logins, devices and alerts (uploaded)" | Login and session history; device registration; digital-token activation; IP addresses; payee, limit or contact-detail changes; alert and SMS delivery logs; account block |
| `card_authentication_record` | "the institution's record of how card payments were authenticated (uploaded)" | Per card payment: time, merchant, country, entry mode, authentication method and result, where the code or approval was sent, wallet provisioning, authorisation response |

Extraction prompt: a record produced by the institution listing these items is typed as above even when it arrives inside a letter; a letter that only describes them in prose stays `bank_correspondence`.

**3b. Facts** (stages `bank` and `fidrec`):

- `access_events[]` — `{ timestamp, kind, deviceLabel, deviceRef, ip, channel, sentTo, relatedTransactionIndex }`; `kind` ∈ `login`, `new_device_login`, `token_activated`, `device_registered`, `payee_added`, `limit_changed`, `contact_details_changed`, `otp_sent`, `alert_sent`, `payment_authenticated`, `account_blocked`, `other`.
- `card_auth_events[]` — `{ timestamp, transactionIndex, cardScheme, merchant, merchantCountry, entryMode, authentication, authenticationResult, sentTo, deviceLabel, walletProvisionedAt, walletDeviceLabel }`; `entryMode` ∈ `chip`, `contactless`, `key_entered`, `ecommerce`, `wallet_token`, `not_known`; `authentication` ∈ `three_ds_otp`, `three_ds_in_app`, `wallet_device`, `pin`, `none_recorded`, `not_known`.
- `device_recognition[]` — per distinct device: `mine` | `not_mine` | `not_sure`. Answer-only; the confirm screen lists each device with its first-seen time. Always written as "the complainant states".
- `access_record_requested` — `ReportedEvent`: whether the complainant asked the institution for these records, and the answer.
- `card_dispute_requested` — `ReportedEvent`: whether the complainant asked the institution to dispute the card payments, when, and how.
- `card_dispute_response` — `{ status: raised | declined | no_answer | not_known, date, reasonStated, outcome }`, from the institution's letters only.
- `institution_fault_label` — the word or phrase the institution's final reply uses for the complainant's conduct, and the conduct it cites, each with its evidence ID. From `bank_correspondence` above the confidence threshold only.

Only the two new document types can supply or contradict `access_events` and `card_auth_events`.

**3c. IP location lookup (decision 4).**

- Look each IP address up in an **IP location database from an outside provider, loaded into our own environment** (candidates: MaxMind GeoLite2, DB-IP Lite, IP2Location LITE; check each licence for commercial use and attribution before choosing). The address is then never sent to a third party. A live lookup API is used only if Elena approves the provider and the privacy policy names it.
- Store per address: country, region and city as the database gives them, accuracy radius where given, network owner (ASN and organisation), whether the network is flagged as hosting, VPN or proxy where the database says so, and the **database name and edition date**.
- Printed form: "IP address [x] — according to [database, edition date]: registered to [network owner], location [city, country] (accuracy about [N] km)." Where flagged: "The database lists this network as a hosting or VPN provider."
- Fixed sentence under the table: "An IP location is the provider's estimate of where the network is registered or used. It can differ from where the person was, for example on mobile data, a VPN or a hosting service. Addresses can be reassigned over time; this lookup used a database dated [date]."
- Where the institution's record states a location itself, print both, each attributed.
- No sentence states where a person was.

**3d. Pack and bank pack.** `FidrecPackReport` gains `access_records`, `card_authentication_records` and `ip_locations` tables. `PROOF` entries: "the institution's own record of logins, devices and alerts for the dates of the payments" and "the institution's record of how each card payment was authenticated"; both end "you can ask the institution for it in writing". The S$18 bank pack's request list asks for whichever is missing, citing EUPG 4.25 (dates, timestamps and parties to the transactions; device and IP data are not listed there, and the request says so).

**3e. Privacy.** Device identifiers and IP addresses are personal data and may be a third party's. Never write them to `analytics_events`, `model_usage` or logs; include the new facts in export and deletion; update the privacy policy before release (new data category; IP database provider). Fixtures synthetic.

**Gate:** contract tests for extraction from synthetic access and card-authentication records; confirm-screen e2e for device recognition.

### Phase 4 — Server-written comparisons

New files beside `rules/srf.ts`. Every check returns `{ clauseKey, record, expected, outcome: differs | matches | not_shown, evidenceIds }` and prints in the form of section 4.

**4a. `rules/duty-time-checks.ts` — layer 1 (EUPG, SRF)**

| Check | Compares | Clause |
|---|---|---|
| Cooling-off | `token_activated` or `new_device_login` → first high-risk activity or disputed payment; 12 hours | EUPG 4.7; SRF duty 1 |
| Alerts: token and high-risk activity | an `alert_sent` at each such event, and `sentTo` | EUPG 4.9; SRF duty 2 |
| Alerts: outgoing payments | an `alert_sent` for each disputed payment | EUPG 4.10–4.11; SRF duty 3 |
| Reporting channel and kill switch | report time, `account_blocked` time, payments after the report | EUPG 4.14; SRF duty 4 |
| Fraud surveillance | pattern and thresholds from the SRF text; payments on or after 16 Jun 2025 | EUPG 4.21; SRF duty 5 |
| Investigation time | `reported_to_bank` → `bank_reply`; 21 / 45 business days | EUPG 4.26 |
| Information on enquiry | `access_record_requested` = yes and what was supplied | EUPG 4.25 |
| Account holder's reporting time | first alert → `reported_to_bank`; as soon as practicable, within 30 calendar days | EUPG 3.14 |

**4b. `rules/mas-notice-checks.ts` — layer 2**

Route by institution type (`institutions.ts`): bank → FSM-N05, FSM-N06; non-bank card licensee → FSM-N07, FSM-N08; payment-system licensee → FSM-N13, FSM-N14; e-wallet major payment institution → the MAS circular on MPI anti-scam measures.

Checks in version 1 of this file:

| Check | Record | Expected (clause) |
|---|---|---|
| Access by an unrecognised device | each `login` / `new_device_login` from a device the complainant states is not hers, with how it was authenticated | Technology-risk notice, customer-information clause (para 9 in FSM-N07; confirm number in FSM-N05): IT controls to protect customer information from unauthorised access or disclosure |
| Changes made in the session | `contact_details_changed`, `limit_changed`, `payee_added` from such a device, and whether an alert went to the previous contact | Same clause; TRM Guidelines section once loaded |
| System availability | only where the facts record that the reporting channel, kill switch or alerts were unavailable or delayed, with times | Technology-risk notice, availability and recovery paragraphs |

Example output (invented values, for the form only):

> **Record:** The institution's record shows a login at 21:14 on 3 March 2025 from a device labelled "Android SM-A515" (E4). The complainant states that this device is not hers. The record shows the login used the account password and a one-time code sent by SMS (E4).
> **Expected:** Under MAS Notice FSM-N05, paragraph [n] (in force from 10 May 2024), a bank is to implement IT controls to protect customer information from unauthorised access or disclosure (R6).
> **Side by side:** The notice expects controls against unauthorised access to customer information. The record shows access from a device the complainant states is not hers, using the account password and a one-time code.

Do not add an FSM-N06 4.6 check for customer logins (1.3). Further checks are added only after the notice text is in the corpus and the clause is read.

**4c. Industry practice — layer 3.** Same form, against the dated MAS–ABS measures (for example the token-activation delay and the alert to the existing contact when a new token is requested), using only measures whose announced start date is on or before the event.

**4d. `rules/customer-conduct.ts` — decision 6**

Step 1, conduct markers from confirmed facts and evidence, each with its source:

| Marker | From |
|---|---|
| Entered credentials or code on a fake site or app | `credentials_or_otp_shared` |
| Gave credentials or code by phone or message | `credentials_or_otp_shared` |
| Installed an app outside the official store / malware | `credentials_or_otp_shared`, `scam_type` |
| Approved a card payment by one-time code or in-app | `card_auth_events.authentication` |
| Alerts sent, and time from first alert to report | `access_events`, `reported_to_bank` |
| Used the block / kill switch, and when | `access_events`, answers |
| Police report, and when | `reported_to_police` |

Step 2, for each regime that applies to the payment (account → EUPG, SRF; card → ABS card code; always → the institution's own terms by tag, as of the payment date), print:

- the term the document uses and where (1.4);
- whether the document defines it or gives examples, and the examples;
- for each marker, whether the document's text names that conduct, quoting the clause reference: `named` / `not_named` / `document_has_no_such_test`.

Step 3, the institution's own words: `institution_fault_label` and the conduct it cites.

Step 4, fixed closing lines, chosen by code:
- "The institution's letter describes the complainant's conduct as '[label]' (E2). The conduct it cites is [conduct]."
- "[Document] uses the term '[term]' and [defines it as … / does not define it]."
- "[Document] does not use the term '[label]'."
- "The SRF Guidelines do not apply a customer-fault test; under them the loss follows the institution's and the telco's duties."
- "The institution's own terms in force on [date] [define '[label]' as … (R9) / use '[label]' without defining it / are not held for that date]."

No line says the institution's label is right or wrong. The reader sees the label, the conduct, and each document's own words.

**4e. Prompt.** The model may cite the new evidence IDs and clause IDs. The arguments for the institution must include, where the facts support it, that the correct credentials or a one-time code were used and that the customer-fault term it relies on appears in its terms or the code.

**Gate:** boundary tests (11 h 59 min / 12 h; 30 / 31 days; 21 / 22 business days); every forbidden word rejected; a case with no technical record yields `not_shown` throughout.

### Phase 5 — "Standards" section by retrieval

For clauses no rule cites. Server builds the query from confirmed facts (regime, institution, earliest payment date, card scheme), calls `match_standards_v1` once per layer, numbers results R1…, prints reference, version, effective dates and link. The model may cite only those IDs. Golden set of at least 20 questions with the expected document and clause; CI fails on a superseded version, a wrong-institution contract, or a missing layer.

### Phase 6 — Institutions' own terms

Per institution: account terms; electronic and digital banking terms; credit and debit card agreements; its SRF / EUPG page. Start with DBS/POSB, OCBC, UOB, Standard Chartered, Citibank, HSBC, Maybank, Trust, GXS, MariBank; then the remaining banks MAS lists for the SRF; then e-wallet providers.

- Chunk by numbered clause; keep number, heading and parent heading; tag per section 2.
- Each version per section 3.2, with the historic-version rule (3.2 rule 6).
- **Gate:** Elena's lawyer confirms that holding these documents and showing short clauses with a source link is acceptable use, before any pack prints contract text.

### Phase 7 — Card scheme rules and the dispute comparison (decision 5)

Load the current public editions: Visa Core Rules and Visa Product and Service Rules; Mastercard Chargeback Guide and Mastercard Rules. Sections in 1.5 first. Same lawyer gate as Phase 6 for printing scheme text.

`rules/card-dispute-checks.ts`, per disputed card payment, Visa first:

| Condition in the scheme's rules | Record |
|---|---|
| Cardholder denies authorising or taking part (10.3 / 10.4) | confirmed facts; `device_recognition` |
| Card-absent, or key-entered card-present | `card_auth_events.entryMode` |
| Not within an invalid-dispute case: authenticated through Visa Secure; authenticated token payment | `card_auth_events.authentication`, `authenticationResult` |
| Within 120 calendar days of the transaction processing date | payment date → `card_dispute_requested.date`, or → `reported_to_bank` |
| Issuer reported the fraud to the scheme before disputing | institution's letters only; otherwise `not_shown` |

Then, fixed lines chosen by code:
- "The complainant asked the institution to dispute these payments on [date] (E5)." / "The records do not show that the complainant asked the institution to dispute these payments."
- "The institution's letter states that it [raised a dispute on [date] / did not raise a dispute because '[reason]'] (E2)." / "The institution's letters do not say whether it raised a dispute."
- Where every condition above is `matches` and the response is `declined` or `no_answer`: "On the records provided, the conditions the scheme's rules set for a fraud dispute are shown for [N] payment(s). The scheme's rules allow, and do not require, an issuer to raise a dispute; they require the issuer to resolve cardholder disputes (Visa Rules 11.1.2) (R11)."
- Where the payment was authenticated through 3-D Secure: "The scheme's rules list a payment authenticated through Visa Secure as one an issuer cannot dispute as fraud (R12)."

The layer-5 standing sentence is printed above. `rules/srf.ts` card wording (ABS card code, then chargeback) stays as layer 1 for cards.

---

## 6. Why this order

1. **Versioning before any large load.** Loading ten banks' terms into the present tables would mean loading them twice.
2. **Evidence before comparisons.** A comparison has nothing to compare until the access and card records are facts.
3. **Regulators' texts before contracts.** They are few, public, stable and already half-loaded, and they are what `duty-time-checks` and `mas-notice-checks` cite. Contracts and scheme rules are large, differ by institution and date, need historic versions, and wait on the lawyer gate.
4. **Coded comparisons before open retrieval.** They are the part of the pack an adjudicator can check line by line, and they work on a small, verified corpus.

Phases 0–4 give a pack that compares technical evidence with the EUPG, SRF, ABS card code and MAS notices. Phases 5–7 add the institution's terms and the scheme rules.

## 7. Acceptance

- Every clause embedded, versioned and sourced; every rule's `clause_key` resolves.
- A synthetic case with access and card records produces all comparison sections with correct arithmetic at each boundary and none of the forbidden words.
- A synthetic case with no technical record produces `not_shown` lines and the bank-pack request.
- IP lookups run against the local database only; each printed location names the database and its date.
- Customer-conduct section prints the institution's label, the conduct, and each document's own term; no line judges the label.
- Version tests in 3.2 rule 7 pass. All existing gates pass.

## 8. Open items

- Lawyer: wording of the standing sentences in section 4; printing contract and scheme text; reading of FSM-N06 4.6; the general-law meaning of "gross negligence" where a document leaves it undefined (the pack states only that the document does not define it).
- SRF fraud-surveillance thresholds: from the Guidelines text.
- FSM-N05 paragraph numbers; current Mastercard edition; whether FSM-N13/N14 reach e-wallet providers in SRF scope.
- Choice of IP database and its licence.

## 9. Sources read on 20 November 2026

- MAS, cyber security regulation page: https://www.mas.gov.sg/regulation/cyber-security
- MAS Notice FSM-N06: https://www.mas.gov.sg/-/media/mas-media-library/regulation/notices/trpd/notice-fsm-n06/mas-notice-fsm-n06.pdf
- MAS Notice FSM-N07: https://www.mas.gov.sg/-/media/mas-media-library/regulation/notices/trpd/notice-fsm-n07/mas-notice-fsm-n07.pdf
- MAS, E-Payments User Protection Guidelines, effective 16 December 2024: https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidelines/pso/e-payments-user-protection-guidelines-with-effect-from-16-dec-2024/e-payments-user-protection-guidelines-with-effect-from-16-december-2024.pdf
- MAS, response to feedback on the proposed EUPG (2018): https://www.mas.gov.sg/-/media/mas/resource/publications/consult_papers/2018/p0042018-response-to-feedback-received-on-proposed-epayments-user-protection-guidelines.pdf
- MAS, Guidelines on Shared Responsibility Framework (page): https://www.mas.gov.sg/regulation/guidelines/guidelines-on-shared-responsibility-framework
- MAS–IMDA, response to consultation on the SRF: https://www.mas.gov.sg/-/media/mas-media-library/publications/consultations/pd/2023/srf/mas-imda-response-to-consultation-on-shared-responsibility-framework.pdf
- MAS, written reply on credit card fraud, 7 January 2025: https://www.mas.gov.sg/news/parliamentary-replies/2025/written-reply-to-pq-on-credit-card-fraud
- MAS, written reply on SRF and fraud surveillance, 3 February 2026: https://www.mas.gov.sg/news/parliamentary-replies/2026/written-reply-to-pqs-on-srf-and-fraud-surveillance
- MAS, Singapore's Broad Strategy to Combat Scams: https://www.mas.gov.sg/regulation/combatting-scams
- ABS, Code of Practice for Banks – Credit Cards: https://abs.org.sg/docs/library/code-of-practice-for-banks---credit-cards_68422ccf-ca83-4635-a658-bda71bc50f2a.pdf
- FIDReC, case study 35: https://www.fidrec.com.sg/knowledgebase/article/KA-01330/en-us
- Singapore Law Gazette, "Fraudulent Transactions in an Online World": https://lawgazette.com.sg/feature/fraudulent-transactions-in-an-online-world/
- Visa Core Rules and Visa Product and Service Rules, public edition dated 13 April 2024: https://bo.review.visa.com/content/dam/VCOM/download/visa-rules-public.pdf
- Repository: `docs/release/regulatory-corpus-audit-2026-11-08.md`; `supabase/functions/_shared/facts/` on `feat/fidrec-pack-2026-11`.
