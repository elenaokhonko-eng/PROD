# DRAFT: privacy wording for the institution's technical records

**Status: draft for legal review. Not in force. Elena's changes of 24 November are applied below. The live policy (`docs/legal/privacy-policy.md`) is not changed by this file.**

Written by Lane 2 of the FIDReC pack update (brief v5, section 3e), 24 November 2026; updated the same day after the review (approved in principle; provider DB-IP Lite chosen, decision 10; credit bureau report added, decision 8). When approved, the wording below goes into the next version of the privacy policy (after 2.2) before the FIDReC update is released. Square brackets mark what is still to be decided.

## What changes in the service

- Users can upload two new kinds of document: the bank's or payment provider's record of logins, devices and alerts, and its record of how card payments were authenticated.
- From these we read: times of logins and other account events; device names and device or token references; IP addresses; where one-time codes and alerts were sent; how each card payment was authenticated; cards added to mobile wallets.
- The user tells us, for each device in the records, whether it is theirs, not theirs, or whether they are not sure.
- Each IP address is looked up in DB-IP's "IP to City Lite" and "IP to ASN Lite" databases (DB-IP Lite), which we download monthly and hold in our own systems. The lookup runs in our own systems: the address is not sent to DB-IP. Each lookup is kept with the database date it used.
- The records are documents the user uploads, so the AI providers that read uploaded documents read them too.
- Users can also upload a credit bureau report (optional; never required). From it, from the bank's letters and statements, or from the user's own account, we read: requests to pay the disputed amount, fees and interest charged on it, reports of non-payment to a credit bureau, and the dates of a dispute with FIDReC. What the user tells us is labelled as their own statement.
- These details are printed in the paid packs only, never in the free evaluation.

## Proposed text

### Section 1, "What we collect": new row after "Documents you upload"

| Category | Examples | Where it comes from |
| --- | --- | --- |
| Your bank's technical records | The bank's or payment provider's record of logins, devices, IP addresses, digital-token activation, alerts and how card payments were approved; your answer, for each device listed, on whether it is yours | You, when you upload the records and answer our questions about them |
| Your credit bureau report | A report from a credit bureau, if you choose to upload one; from it and from your bank's letters and statements, the requests to pay a disputed amount, fees and interest charged on it, and any report of non-payment to a credit bureau | You, when you upload it or tell us about it |

Add after the table, beside the paragraph on sensitive case data:

> Technical records often contain details of other people: a device or an IP address in your bank's records may belong to someone else, including whoever made the payments you dispute. We use these details only to set out what the records show in the packs you ask for. We do not try to identify anyone from them.

### Section 2, "Why we use it": new bullet after "to save your case, check your facts…"

> - to look up the IP addresses in your bank's records in an IP location database, so your pack can show which network each address is registered to and the database's estimate of its location;

### Section 3, "Who we share it with": sentence under the providers table

> IP addresses in your documents are looked up in a copy of DB-IP's IP location database (DB-IP Lite) that we keep in our own systems and update monthly. We do not send the addresses to DB-IP or to any other lookup service. IP Geolocation by DB-IP (https://db-ip.com), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The AI providers listed above read these records as part of your document.

If a live lookup service is ever used instead (brief 3c: only with Elena's approval), it becomes a provider row in this table, and this sentence changes.

DB-IP's Lite licence (read on 24 November 2026 at https://db-ip.com/db/lite.php) is CC BY 4.0: commercial use is allowed with attribution, and DB-IP asks for the link "IP Geolocation by DB-IP" to https://db-ip.com where results are shown. The packs print the same attribution after the IP lookups.

### Section 6, "How long we keep it"

No new row is needed: the technical records, the device answers, the credit bureau report and the facts read from it are case data and follow the "Your account and open cases" and "Case data after you close your account or delete a case" rows. [Confirm with Elena.]

### Section 7, "Your rights": sentence after the list

> Your data export includes the technical records we read from your documents, your answers about each device, and what we read about charges and credit bureau reports on a disputed amount. It also lists the documents you uploaded to each case (file name, document type and upload date), not the files themselves. Deleting a case deletes them, and any credit bureau report you uploaded.

### Section 8, "Cookies and analytics": sentence at the end

> Device references and IP addresses from your bank's records are never part of our usage data, our model usage records or our error logs.

## What the user sees in the packs (for consistency with the policy)

Every IP lookup is printed with the database's name and edition date and this fixed note (brief 3c): "An IP location is the provider's estimate of where the network is registered or used. It can differ from where the person was, for example on mobile data, a VPN or a hosting service. Addresses can be reassigned over time; this lookup used a database dated [date]."

Each device answer is printed as what the complainant states. A report to a credit bureau that only the complainant mentions is printed as the complainant's own statement.

After the IP lookups each pack prints the attribution: "IP Geolocation by DB-IP (https://db-ip.com), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the IP to City Lite and IP to ASN Lite files were combined and converted for this lookup." [Draft wording; only "IP Geolocation by DB-IP" and the link are DB-IP's own words.]

## Points for Elena

1. Approve or change each proposed passage above.
2. Provider: DB-IP Lite (decision 10). Approve the attribution wording in sections 3 and in the packs.
3. Confirm that the retention rows in section 6 cover the new data without a separate row.
4. The AI providers row in section 3 already covers the models reading uploaded documents; the technical records are read the same way. Confirm no change is needed there.
5. The policy version number and effective date for the release that carries this.
6. The credit bureau report row in section 1 and the export sentence in section 7 (decision 8).
7. Decided (Elena, 24 November): the export lists the uploaded documents (file name, document type, upload date), not the files themselves. Built in `app/api/privacy/export/`.
