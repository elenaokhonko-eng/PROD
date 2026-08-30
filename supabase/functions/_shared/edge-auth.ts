export type HarborEdgeActorKind = "user" | "worker" | "admin";

export interface HarborEdgeContext {
  requestId: string;
  audience: string;
  actorKind: HarborEdgeActorKind;
  actorId: string;
  caseId: string | null;
  documentId: string | null;
  jobId: string | null;
  jobLockedAt: string | null;
  bodySha256: string;
  signedAt: string;
}

export interface VerifiedHarborEdgeRequest<T extends Record<string, unknown>> {
  body: T;
  context: HarborEdgeContext;
}

export class HarborEdgeAuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "HarborEdgeAuthError";
  }
}

const SIGNATURE_VERSION = "v1";
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;

function requiredHeader(req: Request, name: string): string {
  const value = req.headers.get(name);
  if (value === null) throw new HarborEdgeAuthError(`Missing ${name}`);
  return value;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function edgeAuthorizationSecret(): string {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (name: string) => string | undefined } };
  };
  return runtime.Deno?.env?.get?.("EDGE_PROXY_HMAC_SECRET") ?? "";
}

function hexToBytes(value: string): Uint8Array {
  if (!HEX_SHA256_PATTERN.test(value)) throw new HarborEdgeAuthError("Invalid signature encoding");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes))));
}

function optionalContextHeader(req: Request, name: string): string | null {
  const value = requiredHeader(req, name);
  return value.length > 0 ? value : null;
}

function bodyString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function verifyHarborEdgeRequest<T extends Record<string, unknown>>(
  req: Request,
  expectedAudience: string,
): Promise<VerifiedHarborEdgeRequest<T>> {
  if (req.method !== "POST") throw new HarborEdgeAuthError("POST only", 405);

  const version = requiredHeader(req, "x-harbor-edge-version");
  const target = requiredHeader(req, "x-harbor-edge-target");
  const timestamp = requiredHeader(req, "x-harbor-edge-timestamp");
  const requestId = requiredHeader(req, "x-harbor-edge-request-id");
  const suppliedBodyHash = requiredHeader(req, "x-harbor-edge-body-sha256").toLowerCase();
  const audience = requiredHeader(req, "x-harbor-edge-audience");
  const actorKind = requiredHeader(req, "x-harbor-edge-actor-kind") as HarborEdgeActorKind;
  const actorId = requiredHeader(req, "x-harbor-edge-actor-id");
  const caseId = optionalContextHeader(req, "x-harbor-edge-case-id");
  const documentId = optionalContextHeader(req, "x-harbor-edge-document-id");
  const jobId = optionalContextHeader(req, "x-harbor-edge-job-id");
  const jobLockedAt = optionalContextHeader(req, "x-harbor-edge-job-locked-at");
  const suppliedSignature = requiredHeader(req, "x-harbor-edge-signature");
  const expectedTarget = `/functions/v1/${expectedAudience}`;

  if (version !== SIGNATURE_VERSION || audience !== expectedAudience || target !== expectedTarget) {
    throw new HarborEdgeAuthError("Invalid signed audience");
  }
  if (!UUID_PATTERN.test(requestId)) throw new HarborEdgeAuthError("Invalid request ID");
  if (!(["user", "worker", "admin"] as const).includes(actorKind)) {
    throw new HarborEdgeAuthError("Invalid actor kind");
  }
  if (!actorId) throw new HarborEdgeAuthError("Missing actor ID");

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    throw new HarborEdgeAuthError("Stale signed request");
  }

  const rawBody = new Uint8Array(await req.arrayBuffer());
  if (rawBody.byteLength > MAX_BODY_BYTES) throw new HarborEdgeAuthError("Request body is too large", 413);
  const bodyHash = await sha256Hex(rawBody);
  if (!HEX_SHA256_PATTERN.test(suppliedBodyHash) || suppliedBodyHash !== bodyHash) {
    throw new HarborEdgeAuthError("Request body hash mismatch");
  }

  const canonical = [
    SIGNATURE_VERSION,
    "POST",
    expectedTarget,
    timestamp,
    requestId,
    bodyHash,
    audience,
    actorKind,
    actorId,
    caseId ?? "",
    documentId ?? "",
    jobId ?? "",
    jobLockedAt ?? "",
  ].join("\n");
  const secret = edgeAuthorizationSecret();
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new HarborEdgeAuthError("Edge authorization is not configured", 503);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signaturePrefix = `${SIGNATURE_VERSION}=`;
  if (!suppliedSignature.startsWith(signaturePrefix)) {
    throw new HarborEdgeAuthError("Invalid request signature");
  }
  const signatureBytes = hexToBytes(suppliedSignature.slice(signaturePrefix.length).toLowerCase());
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    ownedArrayBuffer(signatureBytes),
    new TextEncoder().encode(canonical),
  );
  if (!valid) throw new HarborEdgeAuthError("Invalid request signature");

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new HarborEdgeAuthError("Invalid JSON body", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HarborEdgeAuthError("JSON body must be an object", 400);
  }
  const body = parsed as T;

  if (
    bodyString(body, "case_id") !== caseId ||
    bodyString(body, "document_id") !== documentId ||
    bodyString(body, "job_id") !== jobId ||
    bodyString(body, "job_lock_token") !== jobLockedAt
  ) {
    throw new HarborEdgeAuthError("Signed context does not match request body");
  }

  return {
    body,
    context: {
      requestId,
      audience,
      actorKind,
      actorId,
      caseId,
      documentId,
      jobId,
      jobLockedAt,
      bodySha256: bodyHash,
      signedAt: new Date(timestampSeconds * 1000).toISOString(),
    },
  };
}

export async function authorizeHarborEdgeRequest(
  supabase: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> },
  context: HarborEdgeContext,
): Promise<void> {
  const { data, error } = await supabase.rpc("consume_edge_request_v1", {
    p_request_id: context.requestId,
    p_audience: context.audience,
    p_body_sha256: context.bodySha256,
    p_actor_kind: context.actorKind,
    p_actor_id: context.actorId,
    p_case_id: context.caseId,
    p_document_id: context.documentId,
    p_job_id: context.jobId,
    p_job_locked_at: context.jobLockedAt,
    p_signed_at: context.signedAt,
  });
  if (error || data !== true) {
    throw new HarborEdgeAuthError(error?.message ?? "Signed request was not authorized", 403);
  }
}
