# Agent brief: FIDReC pack — technical evidence, versioned standards corpus, and server-written comparisons

Version 3, 21 November 2026. Written by Claude (chat session) for Elena and the Claude Code agent.
Read against `main` @ 2733f13 and `feat/fidrec-pack-2026-11` @ d5b8338. Nothing in this brief is implemented yet.

**How to use this brief.** Work the phases in order. Each phase ends with a gate. Schema migrations run on staging only after Elena approves them. Follow `CLAUDE.md`: no real case data in the repo, fixtures are synthetic, report IDs and counts only.

**Changed in version 3:** decisions 10–14; EUPG card scope (1.4a) and its effect on the time checks (4a); card provisioning sources (1.7); the account-access sequence rule (4f); the customer-fault definitions section with linked statements and per-institution term requests (4d, 4e); versioning made a precondition for any quoted clause (3.2 rules 8–9); quoting switches in place of a blocking lawyer gate (Phases 6, 7).

---

## 0. Decisions Elena has made (20–21 November)

1. The pack takes in the institution's own technical records as evidence. Two document types: **access records** (logins, devices, IP addresses, token activation, alerts) and **card authentication records**.
2. Technical evidence is compared, by the server, against time-stamped duties in the EUPG, the SRF Guidelines and the ABS card code, **and against MAS notices** to banks and other financial institutions, and against industry practice.
3. Every comparison uses one fixed form: the fact from the evidence; what the document expects of the institution; the two set side by side. **No sentence says a duty was breached or met. We speak in facts.**
4. **IP addresses are looked up** for location and network owner.
5. Card cases: the pack sets out the conditions under which the card scheme's rules let the issuer raise a dispute, whether the record shows those conditions, whether the cardholder asked, and what the institution did.
6. A server-written **customer-conduct comparison**: what each document calls negligence, gross negligence or recklessness, set beside the conduct the evidence shows and the label the institution used.
7. **Every document in the corpus is versioned.** For contracts the version that counts is the one in force on the payment date.
8. All of the above is to be enabled. The phases are a build order, not a choice of scope.
9. Bank pack (S$18): when no technical record is uploaded, its request list asks the institution for one.
10. **Account-access sequence.** The pack has a server-written section that states, neutrally and in order, the sequence the records show: digital token activated → login from that device → card added to a wallet and/or card payments authenticated through 3-D Secure with that token → what the card scheme's rules say about disputing payments authenticated that way → what the institution did.
11. **Customer-fault definitions section.** The pack prints what each framework says about customer fault, stated precisely: EUPG (recklessness; two levels), SRF (no customer-fault test), ABS card code (gross negligence; not defined; the issuer finds it), the MAS reply of 7 January 2025, and the institution's own terms.
12. **The institution's definitions are loaded by a configurable request** per institution and product, resolved as of the payment date.
13. **Statements follow their source.** Each fixed statement is linked to the clauses it rests on. When a source document changes, the statement is reviewed before the new version can be used.
14. **Versioning is a precondition for quoting.** No clause is quoted or cited in any pack unless it comes from a verified version (section 3).

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

- **FSM-N06 (banks, cyber hygiene)** paras 4.1–4.6: administrative accounts, patches, security standards, network perimeter, malware protection, multi-factor authentication. Para 4.6 requires MFA for (a) administrative accounts on critical systems and (b) accounts on any system *the bank uses* to access customer information through the internet. On its wording this covers the bank's own accounts, not a customer logging in to online banking. **Do not build a customer-login check on 4.6 unless Elena's lawyer confirms a wider reading.**
- **FSM-N07 (card licensees, technology risk)** paras 4–9: critical systems; availability (unscheduled downtime of a critical system not above 4 hours in 12 months); recovery time objective of 4 hours; notify MAS within 1 hour of discovering a relevant incident; root-cause report within 14 days; **para 9: implement IT controls to protect customer information from unauthorised access or disclosure.** FSM-N05 for banks follows the same structure; confirm its paragraph numbers from the FSM-N05 text at ingestion.
- The clause closest to "protect the account against unauthorised login" is the **customer-information clause of the technology-risk notice**, and after it the MAS Guidelines on Technology Risk Management (guidelines, not a notice). It is a duty to have controls; it is not worded as a promise that no unauthorised access occurs. The institution-side point (credentials and a one-time code were used) is printed beside it.

### 1.4 What each consumer-facing document says about customer fault

Read from the texts on 20–21 November. These are the basis of the statements in 4d.

**EUPG (effective 16 December 2024)**
- The term is **recklessness** (para 5.2). "Gross negligence" does not appear. "Negligence" appears once, about the institution (5.5(a)).
- 5.2: the account holder is liable for the actual loss from an unauthorised transaction where an account user's recklessness was the **primary cause**; recklessness includes deliberately not complying with Section 3; the liability is capped at any applicable transaction or daily payment limit agreed with the institution. The account user is expected to give the information the institution reasonably requires to determine recklessness.
- Footnote 20 examples: (a) storing access codes where third parties can easily access them; (b) knowingly sharing or surrendering access codes to someone who is not an account user, resulting in completed transactions; (c) ignoring notifications, alerts or warnings from the institution; (d) following a third party's instructions to open new bank or card accounts without reasonable basis; (e) keeping unverified sideloaded apps, or apps requesting unrelated device permissions; (f) an easily recognisable access code, but only where the institution specifically instructed against it and warned of the consequences.
- 5.6: the account holder is not liable for the first S$1,000 of loss arising from a third party's action or omission; this does not apply where the loss arises from an account user's failure to comply with a Section 3 duty.
- 5.4–5.5: the account holder is not liable where the loss arises from the institution's action or omission and not from a failure to comply with Section 3: (a) fraud or negligence of the institution, its employee, agent or outsourcing provider; (b) non-compliance with a requirement MAS imposes; (c) non-compliance with any duty in Section 4.
- No paragraph states who must show recklessness. 4.26 and 7.7(b): the institution's report of its investigation gives its reasons, including how an account user may have been reckless or not complied with Section 3.

**1.4a EUPG and cards.** Para 4.1: Section 4 does not apply to credit, charge or debit card transactions except paras 4.2–4.6, 4.10–4.12 and 4.14–4.16. Para 5.1: Section 5 (liability) does not apply to card transactions. Footnote 3: card holders have the liability apportionment in the ABS card code. Para 7.8: the EUPG dispute process does not apply to card disputes the institution resolves under card scheme rules. Para 2.1: "high-risk activities" include, but are not limited to, adding payees, increasing transaction limits, disabling transaction notifications and changing contact details; adding a card to a mobile wallet is not named.

**SRF Guidelines.** No customer-fault test. The loss follows the waterfall on the institution's and the telco's duties (MAS–IMDA response paras 5.6–5.7). Card transactions are outside the SRF (para 8.3(d)). Outside the SRF, institutions consider whether the victim acted responsibly (para 1.2(b)). The Guidelines PDF could not be fetched in the chat session; this is from the MAS–IMDA response. **Check each statement against the Guidelines text at ingestion.**

**ABS Code of Practice for Banks – Credit Cards (rev. 2 July 2020).** The term is **gross negligence** (paras 5(a), 5(b), 5(c), 6). The code does not define it and gives no examples. Para 4 gives card and PIN security advice and does not say that not following it is gross negligence. The issuer "finds" it (5(b), 5(c)); the code does not say who must show it. Effects: no fraud, no gross negligence, reported as soon as reasonably practicable → S$100 cap before the report (5(a)); card details used without the card being stolen, or unauthorised PIN transactions → not liable (6); fraud or gross negligence → 100% (5(b)). Also covers debit cards used like credit cards (5(e)). It is an industry code, a sub-code of the Code of Consumer Banking Practice; it is not legislation and not an MAS instrument.

**MAS written reply of 7 January 2025 (credit card fraud).** Restates the S$100 cap and its conditions (not fraudulent, not grossly negligent, reported as soon as reasonably practicable). States that the S$100 limit will not apply to a cardholder who unwittingly authenticates a 3DS transaction, and that this would be considered negligent. It does not define gross negligence. It also states that cardholders are generally not liable where the merchant did not enable 3DS.

**FIDReC case study 35.** Records that banks have found gross negligence where a wallet with a card was left unattended in an unsecured place.

### 1.5 Card scheme rules (Visa public edition dated 13 April 2024; re-check in the current edition)

"Scheme" means the card network: Visa, Mastercard. Its rules are the terms between the network and the issuing bank.

- 1.1.1.6: the rules govern Visa and its members and give no rights to third parties.
- 11.1.2 (ID 0030208): the issuer **must resolve cardholder disputes** under the rules, extending the protections of applicable law and its customary practice; it must not process invalid disputes.
- Dispute condition 10.4, card-absent fraud (11.7.5): the issuer **may** dispute where the cardholder denies authorising or taking part in the transaction; before disputing it **must report the fraud to Visa**; it provides a certification of the cardholder's denial; time limit **120 calendar days from the transaction processing date**. Invalid, among others: an e-commerce payment authenticated through Visa Secure (ECI 5 with a CAVV in the authorisation); an authenticated token payment where cardholder verification was approved.
- 10.3, key-entered card-present fraud (11.7.4): same permission, same reporting precondition, same 120 days.
- 10.6.1.6 (Asia-Pacific): an issuer found non-compliant with fraud reporting after an on-site review, and not remedied, cannot raise fraud disputes.
- Nothing read obliges an issuer to raise a dispute when a cardholder asks.
- A dispute is the issuer passing a payment back to the merchant's bank. These rules allocate a payment between the issuer and the merchant's bank. They do not say how a loss is shared between the issuer and the cardholder; for cards that is in the ABS card code and the issuer's terms.

The Mastercard Chargeback Guide copy found online was the 2018 edition. Load the current one before writing any Mastercard check or statement.

### 1.6 Code facts

- `fidrec_pack_v1` (`_shared/facts/fidrec-pack.ts`, `run_fidrec_pack_v1`) reads no corpus table. Rules come from `rules/srf.ts` and `rules/fidrec.ts`, whose `cite` fields are free text.
- `DOCUMENT_TYPES` has no technical-record type; `keys.ts` has no fact for devices, logins, tokens, alerts or card authentication.
- `regulatory_*` tables and the match functions are granted ALL to `anon` in the baseline schema.

### 1.7 Card provisioning to mobile wallets (industry and MAS statements)

- ABS media release, 17 February 2025, "Major card issuing banks to step up measures to combat card provisioning scams": describes the scam (card details phished; the card is added to a wallet on the scammer's device using an SMS one-time code the victim passes on); banks will require verification beyond the SMS one-time code to add a card to a mobile wallet, for example in-app controls or digital token authentication, with completion expected by July 2025; banks will remove provisioned cards where there are signs of fraud.
- MAS written reply, 13 January 2026: adding credit cards to mobile wallets is among the higher-risk activities for which SMS one-time codes are being phased out; banks will introduce additional cooling periods for higher-risk activities during 2026 (no duration given).

---

## 2. How fixed rules and the corpus work together

- **The corpus is the library.** It holds the exact text, version, effective dates and source of every clause. It is the only place clause text lives.
- **Rules are the comparison.** Anything that can be decided from facts — hours between two timestamps, days to a deadline, whether an alert was recorded — is computed by code. The same facts give the same output every time and each rule has a test at its boundary.
- **The join:** every rule cites a `clause_key` (for example `mas.eupg/4.7`). At run time the server loads that clause, in the version in force on the relevant date, and prints its reference, version and link beside the computed result. A build-time test fails if any rule cites a clause the corpus does not hold. `rules/srf.ts` and `rules/fidrec.ts` move from free-text cites to `clause_key`.
- **Statements are text that follows its source.** A fixed sentence such as "The EUPG uses the term 'recklessness'" is stored as a `definition_statement` linked to the clauses it rests on and to the hash of the clause text it was written against (4d). It prints only for a clause version it has been reviewed for.
- **Retrieval is for what cannot be coded in advance:** which sections of a long rulebook speak to this case. It is filtered by institution, date, instrument and layer before any similarity ranking.
- **Tagged clauses and term requests bridge the two.** At ingestion each contract clause gets tags (`definition_gross_negligence`, `definition_negligence`, `definition_recklessness`, `customer_security_duty`, `liability_unauthorised`, `notification_deadline`, `dispute_chargeback`, `conclusive_evidence`, `bank_may_block`). A rule asks for "this institution's definition, in force on this date" by a configured request (4e), which is exact, not by similarity.
- **What the model does:** it writes the summary, each side's position and the arguments, citing evidence IDs (E1…) and clause IDs (R1…) that the server gave it. It does not decide whether a duty was met and it writes none of the comparison, sequence or definitions sections.

---

## 3. Versioning

### 3.1 Today

There is none. `regulatory_documents` holds one row per document with a free-text `version`, an `issue_date` and an `effective_date`. There is no end date, no source URL, no stored copy, no hash and no link between an old and a new version. Clauses carry no version. The match functions do not look at dates.

### 3.2 Target design (decision 14: a precondition for every quoted clause)

Effective-dated, immutable versions (slowly changing dimension type 2) with two time axes: when a version was in force, and when we recorded it.

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
  effective_from_override     for paragraphs that start later than the document
  embedding, embedding_model
```

Migrate the existing 10 documents into this shape (one version each); keep the old tables and RPCs until the old pipeline is retired.

**Rules**

1. **As-of retrieval.** `match_standards_v1(query_embedding, p_on_date, p_layers, p_applies_to, p_instrument_scope, p_institution, p_card_scheme, match_count, similarity_threshold)` filters `status = 'verified' and effective_from <= p_on_date and (effective_to is null or effective_to > p_on_date)` before ranking. `get_clause_as_of(clause_key, p_on_date)` and `get_clauses_by_tag(tag, institution, p_on_date)` return exact rows for the rules.
2. **Which date.** Duties about a payment use that payment's date. Reporting and investigation duties use the report date. A case that spans a version change gets each version, labelled with the payments it applies to.
3. **Immutable.** A correction is a new row. Nothing overwrites text that a pack has cited.
4. **Pinned citations.** Each report stores the clause IDs and `text_sha256` it cited, and the statement IDs it printed. Re-opening the report prints the same text. Regenerating after a corpus change is a new report version and says so.
5. **Change detection.** A scheduled job re-fetches each `source_url` monthly and compares `content_sha256`. A change creates a `draft` version with a clause-by-clause diff on `clause_key`. A person sets `effective_from`, marks it `verified`, and the previous version's `effective_to` is closed. Check whether `supabase/functions/url_catalogue` can carry the fetch.
6. **Historic versions.** A bank's site shows only its current terms. Sources for earlier ones, in order: the bank's notice-of-change pages; a web archive copy (`provenance = web_archive`, with the capture date); the complainant's own copy; a request to the institution. Where the version in force on the payment date is not held, the pack says so and shows the nearest version with its dates; it never presents a later version as if it applied.
7. **Tests.** A payment dated before a version's `effective_from` never retrieves it. A case against one institution never retrieves another's contract. Every `clause_key` cited by a rule resolves.
8. **Dependants are reviewed with the version (decision 13).** When a draft version changes, adds or removes a clause, the diff lists every rule (`clause_key` cite), `definition_statement` and `institution_term_request` linked to it. The version cannot be set to `verified` until each one is marked reviewed for that version: confirmed unchanged, reworded, or retired. The old wording stays in force for payments dated under the old version. Nothing rewrites a statement automatically.
9. **No unversioned quoting.** Pack code reads clause text only through the as-of functions. A lint test fails on any direct read of clause text or any hard-coded clause wording outside `definition_statements`.

---

## 4. Standing of each layer, the comparison form, and the server-written sections

| Layer | Source | Standing sentence printed above the group |
|---|---|---|
| 1 | SRF Guidelines; EUPG | "MAS guidelines that set out the duties of institutions and account holders and how losses are shared." |
| 2 | MAS notices (FSM-N05/N06 banks; N07/N08 card licensees; N13/N14 payment-system licensees); MAS circular on MPI anti-scam measures; TRM Guidelines | "MAS notices set duties the institution owes to MAS. This section sets the institution's records beside those duties. It does not say whether a duty was met." |
| 3 | ABS card code; ABS and MAS–ABS announced measures; MAS written replies | "An industry code, announced industry measures and MAS's stated positions. They are not legislation." |
| 4 | The institution's own terms | "The institution's own terms, in the version in force on the date shown." |
| 5 | Visa / Mastercard rules | "Card scheme rules are an agreement between the card scheme and the card issuer. The cardholder is not a party to them. They are shown here as the process available to the issuer." |

**The comparison form (all layers, server-written):**

> **Record:** [fact from the evidence, with its time] (E4).
> **Expected:** Under [document, paragraph, version], [the institution type] is expected to [clause, in the corpus's words or a reviewed statement] (R3).
> **Side by side:** [one of three fixed endings]

Endings, chosen by code:
- `differs` — "The document expects [X]. The record shows [Y]."
- `matches` — "The record shows [X], as the document expects."
- `not_shown` — "The records provided do not show whether [X]."

**No verdict wording.** The pack never states, as its own finding, that anyone breached, violated, failed to meet, did not comply with, is liable for, or was negligent, grossly negligent or reckless. These patterns are added to the `forbidden` list for model output (as `SRF_VERDICT` is today), and a template test asserts that no server-written template or statement contains them as an assertion. The words negligence, gross negligence and recklessness do appear as the documents' own terms and inside quotation marks from the institution's letter with an evidence ID.

### 4a. `rules/duty-time-checks.ts` — layer 1 (EUPG, SRF)

Route by instrument. For card payments only the rows marked "cards" apply (EUPG 4.1).

| Check | Compares | Clause | Applies to |
|---|---|---|---|
| Cooling-off | `token_activated` or `new_device_login` → each high-risk activity (`payee_added`, `limit_changed`, notifications disabled, `contact_details_changed`) within 12 hours. The time to the first disputed payment is printed in the Record line as a fact | EUPG 4.7, 2.1; SRF duty 1 | account |
| Alerts: token and high-risk activity | an `alert_sent` at each such event, and `sentTo` | EUPG 4.9; SRF duty 2 | account |
| Alerts: outgoing payments | an `alert_sent` for each disputed payment | EUPG 4.10–4.12; SRF duty 3 | account, cards |
| Reporting channel and kill switch | report time, `account_blocked` time, payments after the report | EUPG 4.14–4.16; SRF duty 4 | account, cards |
| Fraud surveillance | pattern and thresholds from the SRF text; payments on or after 16 Jun 2025 | EUPG 4.21; SRF duty 5 | account |
| Investigation time | `reported_to_bank` → `bank_reply`; 21 / 45 business days | EUPG 4.26 | account |
| Information on enquiry | `access_record_requested` = yes and what was supplied | EUPG 4.25 | account |
| Account holder's reporting time | first alert → `reported_to_bank`; as soon as practicable, within 30 calendar days | EUPG 3.14 | account |

Where a card was added to a wallet inside the 12 hours after a token activation, the cooling-off check prints, as fixed text: "The guideline's list of high-risk activities names adding payees, increasing transaction limits, disabling transaction notifications and changing contact details, and says the list is not exhaustive. It does not name adding a card to a mobile wallet (R2)."

### 4b. `rules/mas-notice-checks.ts` — layer 2

Route by institution type (`institutions.ts`): bank → FSM-N05, FSM-N06; non-bank card licensee → FSM-N07, FSM-N08; payment-system licensee → FSM-N13, FSM-N14; e-wallet major payment institution → the MAS circular on MPI anti-scam measures.

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

### 4c. Industry practice — layer 3

Same form, against dated announced measures, using only measures whose stated start date is on or before the event.

| Check | Record | Expected |
|---|---|---|
| Token activation delay and alert to the existing contact | `token_activated`, `alert_sent`, `sentTo` | MAS–ABS releases of 2022; take each measure and its start date from the release text at ingestion |
| Verification used to add a card to a mobile wallet | `walletProvisionedAt`, `walletProvisioningAuthentication`, `walletProvisioningSentTo` | ABS release of 17 Feb 2025: verification beyond the SMS one-time code, completion expected by July 2025. For provisioning before August 2025 the line reads "The release gives July 2025 as the expected completion date; this card was added on [date]." |
| Removal of a provisioned card | time from report to wallet token removal, where recorded | ABS release of 17 Feb 2025 |

### 4d. Customer-fault definitions section (decisions 11, 13) — `customer_fault_definitions`

A server-written section printed in every FIDReC pack, before the conduct comparison. It prints, per framework that applies to the disputed payments, the reviewed statements below, each followed by the clause reference, version and link.

**Storage**

```
definition_statements
  id, statement_key           e.g. eupg.fault.term, abs.fault.undefined
  framework                   eupg | srf | abs_card_code | mas_reply | scheme | institution_terms
  applies_to_instrument[]     account_transfer | sg_card | ewallet
  text                        the sentence printed
  clause_keys[]               the clauses it rests on
  reviewed_for[]              { version_id, clause_text_sha256[] , reviewed_by, reviewed_at }
  status                      draft | approved | retired
```

A statement prints only when the clauses resolved as of the payment date match a `reviewed_for` entry. Otherwise the section prints the clause reference and link with "summary under review" and the run is flagged; rule 3.2(8) should make this unreachable.

**Seed statements (drafted from the texts in 1.4; the agent checks each against the corpus text; Elena approves before `approved`)**

EUPG — account payments only:
- `eupg.fault.term` — "The E-Payments User Protection Guidelines use the term 'recklessness' (paragraph 5.2). They do not use the term 'gross negligence'."
- `eupg.fault.examples` — "The Guidelines give examples of recklessness in footnote 20:" followed by the footnote printed from the corpus.
- `eupg.fault.level1` — "Under paragraph 5.6 the account holder is not liable for the first S$1,000 of a loss arising from a third party's action or omission. That protection does not apply where the loss arises from an account user's failure to comply with a duty in Section 3."
- `eupg.fault.level2` — "Under paragraph 5.2 the account holder is liable for the actual loss where an account user's recklessness was the primary cause of the loss, up to any applicable transaction or daily payment limit agreed with the institution."
- `eupg.fault.institution` — "Under paragraphs 5.4 and 5.5 the account holder is not liable for a loss arising from the institution's fraud or negligence, its non-compliance with a requirement imposed by MAS, or its non-compliance with a duty in Section 4, where the loss does not arise from an account user's failure to comply with Section 3."
- `eupg.fault.reasons` — "Under paragraph 7.7 the institution's report of its investigation gives its reasons, including how an account user may have been reckless or may not have complied with Section 3."
- `eupg.fault.cards` (card payments) — "Section 5 of the Guidelines does not apply to credit, charge or debit card transactions (paragraph 5.1). For those the Guidelines refer to the ABS Code of Practice for Banks – Credit Cards (footnote 3)."

SRF — account payments:
- `srf.fault.none` — "The Shared Responsibility Framework Guidelines do not apply a customer-fault test. Under them the loss for a covered phishing scam is borne according to whether the institution, and then the telecommunications operator, met the duties set for them."
- `srf.fault.cards` (card payments) — "Credit, charge and debit card transactions are outside the Shared Responsibility Framework."

ABS card code — card payments:
- `abs.fault.term` — "The ABS Code of Practice for Banks – Credit Cards uses the term 'gross negligence' (paragraphs 5 and 6)."
- `abs.fault.undefined` — "The code does not define gross negligence and gives no examples of it."
- `abs.fault.finder` — "The code refers to the card issuer finding a cardholder grossly negligent (paragraphs 5(b) and 5(c)). It does not say who must show it."
- `abs.fault.effect` — "Under the code a cardholder who has not acted fraudulently or with gross negligence, and who reported as soon as reasonably practicable, is liable for no more than S$100 before the report (paragraph 5(a)), and is not liable where card details were used without the card being stolen (paragraph 6). A cardholder found to have acted with gross negligence is liable for the full amount (paragraph 5(b))."
- `abs.fault.status` — "The code is an industry code issued by The Association of Banks in Singapore. It is not legislation."

MAS reply — card payments authenticated through 3-D Secure:
- `mas.reply.20250107.3ds` — "In a written reply to Parliament on 7 January 2025, MAS stated that the S$100 limit will not apply to a cardholder who unwittingly authenticates a 3DS transaction, and described that as negligent. The reply does not define gross negligence."
- `mas.reply.20250107.no3ds` (payments with `authentication = none_recorded`) — "The same reply states that cardholders are generally not liable where the merchant did not enable 3DS."

Institution's terms — from 4e.

Closing fixed line when both ABS and MAS-reply statements print: "The code's term is 'gross negligence'. The MAS reply's term for authenticating a 3DS transaction is 'negligent'."

### 4e. Configurable term requests (decision 12) — `institution_term_requests`

```
institution_term_requests
  id, institution, product      account | digital_banking | credit_card | debit_card | ewallet
  purpose                       fault_definition | customer_security_duty | liability_unauthorised |
                                notification_deadline | dispute_chargeback | conclusive_evidence
  document_key                  which of the institution's documents to read
  selector                      { clause_keys[] } once a person has confirmed them, else { tags[] }
  quote_mode                    quote | reference_only
  confirmed_by, confirmed_at
```

- One row per institution, product and purpose. Adding or changing an institution is a data change, not a code deploy.
- Resolution: `get_clause_as_of` / `get_clauses_by_tag` for the payment date and the product the payment was made on.
- Printed for `fault_definition`: "[Institution]'s [document title], version in force on [date], clause [ref]:" then the clause (or its reference and link when `quote_mode = reference_only`). Then one fixed line chosen by code: "The clause defines '[term]'." / "The terms use '[term]' and do not define it." / "The terms in force on [date] do not use the terms negligence, gross negligence or recklessness." / "The terms in force on [date] are not held; the nearest version held is dated [date]."
- The "uses but does not define" outcome is decided at ingestion by a person, stored on the request row, and reviewed with each new version (3.2 rule 8).

### 4f. `rules/account-access-sequence.ts` (decision 10) — `account_access_sequence`

A server-written section that prints the sequence the records show, one numbered line per step, each with its time and evidence ID. A step with no record prints "The records provided do not show [step]."

| Step | From | Line |
|---|---|---|
| 1 | confirmed facts | "The complainant states that [how the credentials, card details or code were given, in the confirmed wording] on [date] (E1)." |
| 2 | `access_events`: `token_activated` / `device_registered` | "The institution's record shows a digital token activated at [T1] on a device labelled '[label]' (E4). The record shows the activation was authorised by [method], sent to [contact]." |
| 3 | `device_recognition` | "The complainant states that this device is not hers." / "…is hers." / "…she is not sure." |
| 4 | `access_events`: `alert_sent` | "The record shows an alert about the activation sent at [T] to [contact]." / not shown |
| 5 | `access_events`: logins and high-risk activities from that device | one line each |
| 6 | `card_auth_events`: wallet provisioning | "The record shows the card ending [last four] added to a mobile wallet at [T2] on a device labelled '[label]', authorised by [method] (E6)." |
| 7 | `card_auth_events`: payments | "The record shows [N] card payments totalling [amount] between [T3] and [T4], authenticated by [method] (E6)." Grouped by authentication method |
| 8 | link between 2 and 7 | see below |
| 9 | report and block | "The complainant reported to the institution at [T5] (E2). The record shows the card blocked at [T6]." |

**The link (step 8).** `linked` when a payment's `deviceRef` equals the device in step 2, or the institution's record states that the payment was approved with that token. Lines:
- `linked` — "On the records provided, [N] of these payments were authenticated through 3-D Secure using the digital token activated at [T1] (E4, E6)."
- `not_shown` — "The records provided do not show which device or token authenticated these payments."

**Scheme lines**, printed after step 9, only for a scheme whose current rules are loaded and verified, each with its clause ID and the layer-5 standing sentence above:
- For payments with `entryMode = ecommerce` and `authentication` through 3-D Secure, Visa: "Visa's rules list an e-commerce payment authenticated through Visa Secure as one an issuer cannot dispute as fraud (R12)."
- For authenticated wallet-token payments, Visa: "Visa's rules list an authenticated token payment where cardholder verification was approved as one an issuer cannot dispute as fraud (R13)."
- For payments with no authentication recorded: "Visa's rules allow an issuer to dispute a card-absent payment the cardholder denies making, within 120 calendar days of processing, after reporting the fraud to Visa (R11)."
- Always, after any of the above: "These rules set out which payments an issuer can pass back to the merchant's bank. They do not set out how a loss is shared between the issuer and the cardholder. For cards that is in the ABS Code of Practice for Banks – Credit Cards and the issuer's own terms (R8, R9)."
- Mastercard equivalents are added only after the current Chargeback Guide is loaded and the sections are read.

**Institution's response line:** from `card_dispute_response`, as in Phase 7.

The section makes no statement about who took the token or who made the payments. "Stolen", "scammer" and "fraudster" appear only inside the complainant's confirmed wording in step 1.

### 4g. `rules/customer-conduct.ts` (decision 6) — `customer_conduct_comparison`

Printed after 4d.

Step 1, conduct markers from confirmed facts and evidence, each with its source:

| Marker | From |
|---|---|
| Entered credentials, card details or a code on a website or app reached from a message | `credentials_or_otp_shared` |
| Gave credentials or a code by phone or message | `credentials_or_otp_shared` |
| Installed an app from outside the official store | `credentials_or_otp_shared`, `scam_type` |
| Approved a card payment by one-time code or in-app | `card_auth_events.authentication`, `deviceRef`, `device_recognition` |
| Alerts sent, and time from first alert to report | `access_events`, `reported_to_bank` |
| Used the block / kill switch, and when | `access_events`, answers |
| Police report, and when | `reported_to_police` |

Step 2, for each framework that applies to the payment (account → EUPG, SRF; card → ABS card code, MAS reply; always → the institution's terms from 4e), for each marker, whether the document's text names that conduct: `named` with the clause reference / `not_named` / `document_has_no_such_test`.

Step 3, the institution's own words: `institution_fault_label` and the conduct it cites.

Step 4, fixed closing lines chosen by code:
- "The institution's letter describes the complainant's conduct as '[label]' (E2). The conduct it cites is [conduct]."
- "[Document] uses the term '[term]'." / "[Document] does not use the term '[label]'."
- "The institution's own terms in force on [date] [define '[label]' as set out above (R9) / use '[label]' without defining it / are not held for that date]."

No line says the institution's label is right or wrong.

### 4h. Prompt

The model may cite the new evidence IDs and clause IDs. The arguments for the institution must include, where the facts support it, that the correct credentials or a one-time code were used and that the customer-fault term it relies on appears in its terms or the code. The arguments for the complainant may point to the sequence and the definitions sections by ID; they may not restate them with verdict wording.

### 4i. Order of sections in the FIDReC pack

Existing sections, then: `access_records` → `card_authentication_records` → `ip_locations` → `account_access_sequence` → `duty_time_checks` → `mas_notice_comparison` → `industry_practice_comparison` → `card_dispute_comparison` → `customer_fault_definitions` → `customer_conduct_comparison` → `standards` → arguments for each side.

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

1. Migration for section 3.2, plus `definition_statements` (4d) and `institution_term_requests` (4e); migrate the 10 documents; correct the notice labels and the `FMS-N08` key.
2. Embed every clause; record `embedding_model`.
3. Replace the 10-clause EUPG extract with the full 16 December 2024 text, paragraph by paragraph, footnotes as their own clauses (`mas.eupg/fn20`), with `effective_from_override` on paragraphs that start on 16 June 2025.
4. The three RPCs in 3.2.
5. Grants: read for `authenticated`, nothing for `anon`, writes for `service_role`.
6. Move `rules/srf.ts` and `rules/fidrec.ts` cites to `clause_key`; add the build-time resolution test and the lint test of rule 9.

**Gate:** migration approved; tests in 3.2 rules 7–9 pass.

### Phase 2 — Regulatory and industry sources

Each loaded from the publisher's own site with `source_url`, snapshot and hash.

| Add | Notes |
|---|---|
| SRF Guidelines, full text, checked against the MAS PDF | The five institution duties; the fraud-surveillance thresholds from the text; card exclusion; confirm `srf.fault.*` statements |
| MAS–IMDA response to consultation on the SRF | Paras 1.2(b), 3.4–3.6, 4.6–4.7, 5.6–5.7, 6.7–6.11, 8.3–8.4 |
| MAS Notice FSM-N05 and FSM-N06 (verify existing clauses), FSM-N07, FSM-N08 | Para numbers from the text |
| MAS Guidelines on Technology Risk Management (Jan 2021) | Online financial services and fraud monitoring sections first |
| MAS–ABS media releases of 19 Jan 2022, 2 Jun 2022, 9 Jul 2024, 18 Sep 2024 | `binding_level = announcement` |
| ABS media release of 17 Feb 2025 on card provisioning scams | `announcement`; used by 4c |
| ABS Code of Practice for Banks – Credit Cards, rev. 2 Jul 2020 (verify existing 17 clauses) | Paras 4, 5(a)–(e), 6, 10, 11 |
| MAS written replies: 7 Jan 2025 (card fraud), 13 Jan 2026 (requirements on banks), 3 Feb 2026 (SRF and fraud surveillance) | `announcement`; each sentence relied on is its own clause, so `mas.reply.20250107.*` statements can link to it |
| FIDReC Terms of Reference, current version | `forum_rules` |

Seed and approve the EUPG, SRF, ABS and MAS-reply `definition_statements` in this phase.

### Phase 3 — Technical evidence

**3a. Two document types** added to `DOCUMENT_TYPES`, `DOCUMENT_FACTS`, `DOCUMENT_LABELS`:

| Type | Label | What it is |
|---|---|---|
| `bank_access_record` | "the institution's record of logins, devices and alerts (uploaded)" | Login and session history; device registration; digital-token activation; IP addresses; payee, limit or contact-detail changes; alert and SMS delivery logs; account block |
| `card_authentication_record` | "the institution's record of how card payments were authenticated (uploaded)" | Per card payment: time, merchant, country, entry mode, authentication method and result, where the code or approval was sent, the device or token that approved it, wallet provisioning, authorisation response |

Extraction prompt: a record produced by the institution listing these items is typed as above even when it arrives inside a letter; a letter that only describes them in prose stays `bank_correspondence`.

**3b. Facts** (stages `bank` and `fidrec`):

- `access_events[]` — `{ timestamp, kind, deviceLabel, deviceRef, ip, channel, authorisedBy, sentTo, relatedTransactionIndex }`; `kind` ∈ `login`, `new_device_login`, `token_activated`, `device_registered`, `payee_added`, `limit_changed`, `notifications_disabled`, `contact_details_changed`, `otp_sent`, `alert_sent`, `payment_authenticated`, `account_blocked`, `other`.
- `card_auth_events[]` — `{ timestamp, transactionIndex, cardScheme, merchant, merchantCountry, entryMode, authentication, authenticationResult, sentTo, deviceLabel, deviceRef, tokenRef, walletProvisionedAt, walletDeviceLabel, walletProvisioningAuthentication, walletProvisioningSentTo, walletTokenRemovedAt }`; `entryMode` ∈ `chip`, `contactless`, `key_entered`, `ecommerce`, `wallet_token`, `not_known`; `authentication` ∈ `three_ds_otp`, `three_ds_in_app`, `three_ds_digital_token`, `wallet_device`, `pin`, `none_recorded`, `not_known`; `walletProvisioningAuthentication` ∈ `sms_otp`, `in_app`, `digital_token`, `not_known`.
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

**3d. Pack and bank pack.** `FidrecPackReport` gains `access_records`, `card_authentication_records` and `ip_locations` tables. `PROOF` entries: "the institution's own record of logins, devices and alerts for the dates of the payments" and "the institution's record of how each card payment was authenticated, including the device or token that approved it"; both end "you can ask the institution for it in writing". The S$18 bank pack's request list asks for whichever is missing. For account payments it cites EUPG 4.25 (dates, timestamps and parties to the transactions; device and IP data are not listed there, and the request says so). For card payments it cites no EUPG paragraph (4.25 does not apply to card transactions); it refers to the issuer's investigation under the ABS card code para 5(d) and says the code does not list which records the issuer gives the cardholder.

**3e. Privacy.** Device identifiers and IP addresses are personal data and may be a third party's. Never write them to `analytics_events`, `model_usage` or logs; include the new facts in export and deletion; update the privacy policy before release (new data category; IP database provider). Fixtures synthetic.

**Gate:** contract tests for extraction from synthetic access and card-authentication records; confirm-screen e2e for device recognition.

### Phase 4 — Server-written sections

Build 4a–4i. Every check returns `{ clauseKey, record, expected, outcome: differs | matches | not_shown, evidenceIds }`.

**Gate:** boundary tests (11 h 59 min / 12 h; 30 / 31 days; 21 / 22 business days); instrument routing (a card payment never gets an EUPG 4.7, 4.21, 4.25, 4.26 or Section 5 line); the sequence section with `linked` and `not_shown` fixtures; a statement whose clause hash no longer matches does not print; every forbidden pattern rejected; a case with no technical record yields `not_shown` throughout.

### Phase 5 — "Standards" section by retrieval

For clauses no rule or statement cites. Server builds the query from confirmed facts (regime, institution, earliest payment date, card scheme), calls `match_standards_v1` once per layer, numbers results R1…, prints reference, version, effective dates and link. The model may cite only those IDs. Golden set of at least 20 questions with the expected document and clause; CI fails on a superseded version, a wrong-institution contract, or a missing layer.

### Phase 6 — Institutions' own terms

Per institution: account terms; electronic and digital banking terms; credit and debit card agreements; its SRF / EUPG page. Start with DBS/POSB, OCBC, UOB, Standard Chartered, Citibank, HSBC, Maybank, Trust, GXS, MariBank; then the remaining banks MAS lists for the SRF; then e-wallet providers.

- Chunk by numbered clause; keep number, heading and parent heading; tag per section 2.
- Each version per section 3.2, with the historic-version rule (rule 6).
- Create `institution_term_requests` rows (4e) for each institution and product; a person confirms the `fault_definition` clause keys.
- **Why this is the larger job:** each institution publishes several documents, each needs every version back to the earliest payment date a case can have, and each clause needs tagging. The regulators' texts are about a dozen documents with one or two versions each.
- **Quoting.** `quote_mode` defaults to `quote` for the institution's own terms: a short clause, attributed, with version and link, in the complainant's own complaint about her own contract. Elena's lawyer confirms this default; if advised otherwise, switch rows to `reference_only` (clause number, version, link and the fixed line). Loading, tagging and the rules do not wait on this.

### Phase 7 — Card scheme rules and the dispute comparison (decision 5)

Load the current public editions: Visa Core Rules and Visa Product and Service Rules; Mastercard Chargeback Guide and Mastercard Rules. The Visa public edition read was about 1.8 million characters. Load the sections in 1.5 first and verify them clause by clause; load the rest for retrieval after.

**Quoting.** Scheme rules default to `reference_only`: section number, edition date, link and the reviewed statement in our own words. The cardholder is not a party to these documents and they are the scheme's copyright. Switch to `quote` if Elena's lawyer agrees.

`rules/card-dispute-checks.ts` → `card_dispute_comparison`, per disputed card payment, Visa first:

| Condition in the scheme's rules | Record |
|---|---|
| Cardholder denies authorising or taking part (10.3 / 10.4) | confirmed facts; `device_recognition` |
| Card-absent, or key-entered card-present | `card_auth_events.entryMode` |
| Not within an invalid-dispute case: authenticated through Visa Secure; authenticated token payment | `card_auth_events.authentication`, `authenticationResult` |
| Within 120 calendar days of the transaction processing date | payment date → `card_dispute_requested.date`, or → `reported_to_bank` |
| Issuer reported the fraud to the scheme before disputing | institution's letters only; otherwise `not_shown` |

Then fixed lines chosen by code:
- "The complainant asked the institution to dispute these payments on [date] (E5)." / "The records do not show that the complainant asked the institution to dispute these payments."
- "The institution's letter states that it [raised a dispute on [date] / did not raise a dispute because '[reason]'] (E2)." / "The institution's letters do not say whether it raised a dispute."
- Where every condition is `matches` and the response is `declined` or `no_answer`: "On the records provided, the conditions the scheme's rules set for a fraud dispute are shown for [N] payment(s). The complainant asked the institution to dispute them on [date]. The institution [did not raise a dispute / did not answer]. The scheme's rules allow, and do not require, an issuer to raise a dispute; they require the issuer to resolve cardholder disputes (R11)."
- Where a payment falls within an invalid-dispute case: the matching scheme line from 4f.

`rules/srf.ts` card wording (ABS card code, then chargeback) stays as layer 1 for cards.

---

## 6. Why this order

1. **Versioning before any load or statement.** Every quoted clause and every statement depends on it (decision 14).
2. **Evidence before comparisons.** A comparison has nothing to compare until the access and card records are facts.
3. **Regulators' texts before institutions' terms and scheme rules.** They are few, public, stable and already half-loaded, and they are what 4a–4d cite. The terms and scheme rules are far more text, differ by institution and date, and need historic versions.
4. **Coded sections before open retrieval.** They are the part of the pack an adjudicator can check line by line, and they work on a small, verified corpus.

Phases 0–4 give a pack with the sequence, the time checks, the MAS notice comparison and the definitions section for EUPG, SRF, ABS and the MAS reply. Phases 6–7 fill in the institution's terms and the scheme lines; until then those lines print "not held".

## 7. Acceptance

- Every clause embedded, versioned and sourced; every rule's `clause_key` and every statement's clauses resolve; no pack code reads clause text outside the as-of functions.
- A synthetic case (token activated on an unrecognised device, card added to a wallet, 3-D Secure card payments linked to that token) produces the sequence section with the `linked` line and the Visa line, and no EUPG Section 5 line for the card payments.
- The same case without a card authentication record produces `not_shown` and the bank-pack request.
- The definitions section prints each approved statement with its clause reference and version; changing a linked clause in a draft version blocks `verified` until the statement is reviewed.
- An institution with a configured `fault_definition` request prints its clause as of the payment date; one without prints "not held".
- IP lookups run against the local database only; each printed location names the database and its date.
- No server template, statement or model output contains verdict wording. All existing gates pass.

## 8. Open items

- Lawyer: the standing sentences in section 4; the quoting defaults in Phases 6 and 7; the reading of FSM-N06 4.6; whether to say anything on the general-law meaning of "gross negligence" where a document leaves it undefined (the pack states only that the document does not define it).
- SRF Guidelines text: confirm `srf.fault.*`, the five duties and the fraud-surveillance thresholds.
- FSM-N05 paragraph numbers; current Visa edition section numbers; current Mastercard edition; whether FSM-N13/N14 reach e-wallet providers in SRF scope.
- Whether any institution's record states the token or device that approved a 3-D Secure payment in a form that supports the `linked` test; adjust the extraction after the first real records (kept outside the repo).
- Choice of IP database and its licence.

## 9. Sources read on 20–21 November 2026

- MAS, cyber security regulation page: https://www.mas.gov.sg/regulation/cyber-security
- MAS Notice FSM-N06: https://www.mas.gov.sg/-/media/mas-media-library/regulation/notices/trpd/notice-fsm-n06/mas-notice-fsm-n06.pdf
- MAS Notice FSM-N07: https://www.mas.gov.sg/-/media/mas-media-library/regulation/notices/trpd/notice-fsm-n07/mas-notice-fsm-n07.pdf
- MAS, E-Payments User Protection Guidelines, effective 16 December 2024: https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidelines/pso/e-payments-user-protection-guidelines-with-effect-from-16-dec-2024/e-payments-user-protection-guidelines-with-effect-from-16-december-2024.pdf
- MAS, response to feedback on the proposed EUPG (2018): https://www.mas.gov.sg/-/media/mas/resource/publications/consult_papers/2018/p0042018-response-to-feedback-received-on-proposed-epayments-user-protection-guidelines.pdf
- MAS, Guidelines on Shared Responsibility Framework (page; the PDF was not reachable from the chat session): https://www.mas.gov.sg/regulation/guidelines/guidelines-on-shared-responsibility-framework
- MAS–IMDA, response to consultation on the SRF: https://www.mas.gov.sg/-/media/mas-media-library/publications/consultations/pd/2023/srf/mas-imda-response-to-consultation-on-shared-responsibility-framework.pdf
- MAS, written reply on credit card fraud, 7 January 2025: https://www.mas.gov.sg/news/parliamentary-replies/2025/written-reply-to-pq-on-credit-card-fraud
- MAS, written reply on requirements imposed on banks to protect consumers from scams, 13 January 2026: https://www.mas.gov.sg/news/parliamentary-replies/2026/written-reply-on-effectiveness-of-requirements-imposed-by-mas-on-banks-to-protect-against-scams
- MAS, written reply on SRF and fraud surveillance, 3 February 2026: https://www.mas.gov.sg/news/parliamentary-replies/2026/written-reply-to-pqs-on-srf-and-fraud-surveillance
- MAS, Singapore's Broad Strategy to Combat Scams: https://www.mas.gov.sg/regulation/combatting-scams
- ABS, Code of Practice for Banks – Credit Cards: https://abs.org.sg/docs/library/code-of-practice-for-banks---credit-cards_68422ccf-ca83-4635-a658-bda71bc50f2a.pdf
- ABS, media release on card provisioning scams, 17 February 2025: https://www.abs.org.sg/docs/library/major-card-issuing-banks-to-step-up-measures-to-combat-card-provisioning-scams.pdf
- FIDReC, case study 35: https://www.fidrec.com.sg/knowledgebase/article/KA-01330/en-us
- Singapore Law Gazette, "Fraudulent Transactions in an Online World": https://lawgazette.com.sg/feature/fraudulent-transactions-in-an-online-world/
- Visa Core Rules and Visa Product and Service Rules, public edition dated 13 April 2024: https://bo.review.visa.com/content/dam/VCOM/download/visa-rules-public.pdf
- Repository: `docs/release/regulatory-corpus-audit-2026-11-08.md`; `supabase/functions/_shared/facts/` on `feat/fidrec-pack-2026-11`.
