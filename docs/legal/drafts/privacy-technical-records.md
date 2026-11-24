# DRAFT: privacy wording for the institution's technical records

**Status: draft for Elena's approval. Not in force. The live policy (`docs/legal/privacy-policy.md`) is not changed by this file.**

Written by Lane 2 of the FIDReC pack update (brief v5, section 3e), 24 November 2026. When approved, the wording below goes into the next version of the privacy policy (after 2.2) before the FIDReC update is released. Square brackets mark what is still to be decided.

## What changes in the service

- Users can upload two new kinds of document: the bank's or payment provider's record of logins, devices and alerts, and its record of how card payments were authenticated.
- From these we read: times of logins and other account events; device names and device or token references; IP addresses; where one-time codes and alerts were sent; how each card payment was authenticated; cards added to mobile wallets.
- The user tells us, for each device in the records, whether it is theirs, not theirs, or whether they are not sure.
- Each IP address is looked up in an IP location database that we hold in our own systems. The address is not sent to the database provider or anyone else.
- These details are printed in the paid packs only, never in the free evaluation.

## Proposed text

### Section 1, "What we collect": new row after "Documents you upload"

| Category | Examples | Where it comes from |
| --- | --- | --- |
| Your bank's technical records | The bank's or payment provider's record of logins, devices, IP addresses, digital-token activation, alerts and how card payments were approved; your answer, for each device listed, on whether it is yours | You, when you upload the records and answer our questions about them |

Add after the table, beside the paragraph on sensitive case data:

> Technical records often contain details of other people: a device or an IP address in your bank's records may belong to someone else, including the person who took your money. We use these details only to set out what the records show in the packs you ask for. We do not try to identify anyone from them.

### Section 2, "Why we use it": new bullet after "to save your case, check your facts…"

> - to look up the IP addresses in your bank's records in an IP location database, so your pack can show which network each address is registered to and the database's estimate of its location;

### Section 3, "Who we share it with": sentence under the providers table

> IP addresses in your documents are looked up in a copy of [provider name]'s IP location database that we keep in our own systems. We do not send the addresses to [provider name] or to any other lookup service.

If a live lookup service is ever used instead (brief 3c: only with Elena's approval), it becomes a provider row in this table, and this sentence changes.

[If the chosen database's licence requires attribution, add it here, for example: "This product includes IP location data from [provider], available at [URL]." The licence terms of each candidate are in the Lane 2 pull request.]

### Section 6, "How long we keep it"

No new row is needed: the technical records and the device answers are case data and follow the "Your account and open cases" and "Case data after you close your account or delete a case" rows. [Confirm with Elena.]

### Section 7, "Your rights": sentence after the list

> Your data export includes the technical records we read from your documents and your answers about each device. Deleting a case deletes them.

### Section 8, "Cookies and analytics": sentence at the end

> Device references and IP addresses from your bank's records are never part of our usage data, our model usage records or our error logs.

## What the user sees in the packs (for consistency with the policy)

Every IP lookup is printed with the database's name and edition date and this fixed note (brief 3c): "An IP location is the provider's estimate of where the network is registered or used. It can differ from where the person was, for example on mobile data, a VPN or a hosting service. Addresses can be reassigned over time; this lookup used a database dated [date]."

Each device answer is printed as what the complainant states.

## Points for Elena

1. Approve or change each proposed passage above.
2. Name the IP database provider once chosen, and its attribution wording if its licence needs one.
3. Confirm that the retention rows in section 6 cover the new data without a separate row.
4. The AI providers row in section 3 already covers the models reading uploaded documents; the technical records are read the same way. Confirm no change is needed there.
5. The policy version number and effective date for the release that carries this.
