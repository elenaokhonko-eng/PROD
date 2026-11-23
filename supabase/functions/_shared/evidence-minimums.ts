// The documents a paid pack needs before it is generated (Elena, 23 Nov 2026). Buying is never blocked: the check runs
// after payment, on the screen that starts generation, and again in the web routes and the pack functions, which all
// read this one file so they cannot disagree. A document counts when the evidence pipeline (evidence_processed_v2)
// read it as one of the item's types, or when the customer marked it as that item themselves (complainant_item), for
// when the pipeline misreads a real document.

export type PackProduct = "bank" | "fidrec";

export const EVIDENCE_ITEMS = ["payment_proof", "police_report", "bank_reply_or_complaint", "scam_message"] as const;
export type EvidenceItem = (typeof EVIDENCE_ITEMS)[number];

interface ItemRule {
  products: readonly PackProduct[];
  /** false: suggested only, never blocks generation. */
  required: boolean;
  /** evidence_processed_v2 types that count without the customer saying so. */
  types: readonly string[];
}

export const EVIDENCE_RULES: Record<EvidenceItem, ItemRule> = {
  payment_proof: {
    products: ["bank", "fidrec"],
    required: true,
    types: [
      "BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS",
      "CREDIT_CARD_STATEMENT_SHOWING_TRANSACTIONS",
      "SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS",
    ],
  },
  police_report: { products: ["bank", "fidrec"], required: true, types: ["POLICE_REPORT_OF_FRAUD_SCAM"] },
  bank_reply_or_complaint: {
    products: ["fidrec"],
    required: true,
    types: [
      "BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY",
      "BANK_SRF_INVESTIGATION_REPORT_OR_OFFICIAL_RESPONSE",
      "TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK",
    ],
  },
  scam_message: { products: ["bank", "fidrec"], required: false, types: ["PHISHING_EMAIL_COPY_OR_DESCRIPTION"] },
};

export interface EvidenceDocument {
  id: string;
  verified_document_type: string | null;
  complainant_item: string | null;
  processing_status: string | null;
}

export interface EvidenceItemStatus {
  item: EvidenceItem;
  required: boolean;
  added: boolean;
  documentIds: string[];
  /** Counted only because the customer marked a document as this item. */
  identifiedByComplainant: boolean;
}

export interface EvidenceCheck {
  ready: boolean;
  items: EvidenceItemStatus[];
  missing: EvidenceItem[];
}

export function isEvidenceItem(value: unknown): value is EvidenceItem {
  return typeof value === "string" && (EVIDENCE_ITEMS as readonly string[]).includes(value);
}

export function evidenceItemsFor(product: PackProduct): EvidenceItem[] {
  return EVIDENCE_ITEMS.filter((item) => EVIDENCE_RULES[item].products.includes(product));
}

/** Only documents that have finished processing count; one still being read counts once it is ready. */
export function checkPackEvidence(product: PackProduct, documents: readonly EvidenceDocument[]): EvidenceCheck {
  const ready = documents.filter((d) => d.processing_status === "ready");
  const items = evidenceItemsFor(product).map((item): EvidenceItemStatus => {
    const rule = EVIDENCE_RULES[item];
    const byType = ready.filter((d) => d.verified_document_type !== null && rule.types.includes(d.verified_document_type));
    const byComplainant = ready.filter((d) => d.complainant_item === item && !byType.includes(d));
    const documentIds = [...byType, ...byComplainant].map((d) => d.id);
    return {
      item,
      required: rule.required,
      added: documentIds.length > 0,
      documentIds,
      identifiedByComplainant: byType.length === 0 && byComplainant.length > 0,
    };
  });
  const missing = items.filter((i) => i.required && !i.added).map((i) => i.item);
  return { ready: missing.length === 0, items, missing };
}

export const EVIDENCE_DOCUMENT_SELECT = "id, verified_document_type, complainant_item, processing_status";
