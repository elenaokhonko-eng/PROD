#!/usr/bin/env node
/**
 * Storage copy utility: source → target.
 *
 * Env vars:
 * - SOURCE_REF
 * - STAGING_REF
 * - SOURCE_SERVICE_ROLE_KEY
 * - STAGING_SERVICE_ROLE_KEY
 *
 * Commands:
 * - inventory
 * - ensure-buckets
 * - copy
 * - verify-counts
 * - verify-samples [--per-bucket N]
 * - diff-keys --bucket <name> [--limit N]
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SOURCE_REF = mustEnv("SOURCE_REF");
const STAGING_REF = mustEnv("STAGING_REF");
const SOURCE_SERVICE_ROLE_KEY = mustEnv("SOURCE_SERVICE_ROLE_KEY");
const STAGING_SERVICE_ROLE_KEY = mustEnv("STAGING_SERVICE_ROLE_KEY");

const SOURCE_URL = `https://${SOURCE_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

const argv = process.argv.slice(2);
const cmd = argv[0];
if (!cmd) fatal("Missing command. Use: inventory | ensure-buckets | copy | verify-counts | verify-samples");

const perBucketSamples = getFlagNumber(argv, "--per-bucket", 2);
const debug = argv.includes("--debug");
const evidenceBucketName = "evidence";
const diffBucket = getFlagString(argv, "--bucket");
const diffLimit = getFlagNumber(argv, "--limit", 20);

const cacheDir = path.join(process.cwd(), ".tmp", "storage-copy");
await mkdir(cacheDir, { recursive: true });

const source = storageClient(SOURCE_URL, SOURCE_SERVICE_ROLE_KEY);
const staging = storageClient(STAGING_URL, STAGING_SERVICE_ROLE_KEY);

if (cmd === "inventory") {
  const srcBuckets = await listBuckets(source);
  const tgtBuckets = await listBuckets(staging);
  const srcById = new Map(srcBuckets.map((b) => [b.id, b]));
  const tgtById = new Map(tgtBuckets.map((b) => [b.id, b]));

  const missingOnTarget = srcBuckets.filter((b) => !tgtById.has(b.id)).map((b) => b.id);
  const presentBoth = srcBuckets.filter((b) => tgtById.has(b.id)).map((b) => b.id);

  console.log(JSON.stringify({
    source_ref: SOURCE_REF,
    target_ref: STAGING_REF,
    source_bucket_count: srcBuckets.length,
    target_bucket_count: tgtBuckets.length,
    present_in_both: presentBoth,
    missing_on_target: missingOnTarget,
    evidence_target_public_forced_false: true,
    source_buckets: srcBuckets,
    target_buckets: tgtBuckets,
  }, null, 2));
  process.exit(0);
}

if (cmd === "ensure-buckets") {
  const srcBuckets = await listBuckets(source);
  const tgtBuckets = await listBuckets(staging);
  const tgtById = new Map(tgtBuckets.map((b) => [b.id, b]));

  for (const b of srcBuckets) {
    if (tgtById.has(b.id)) continue;
    const isEvidence = b.id === evidenceBucketName;
    const publicFlag = isEvidence ? false : !!b.public;
    await createBucket(staging, b.id, publicFlag);
    console.log(`created bucket on target: ${b.id} (public=${publicFlag})`);
  }

  // Enforce evidence private on target even if it already existed.
  const tgtEvidence = tgtById.get(evidenceBucketName);
  if (tgtEvidence && tgtEvidence.public === true) {
    await updateBucket(staging, evidenceBucketName, false);
    console.log(`updated bucket on target: ${evidenceBucketName} (public=false)`);
  }

  console.log("done");
  process.exit(0);
}

if (cmd === "copy") {
  const srcBuckets = await listBuckets(source);
  const tgtBuckets = await listBuckets(staging);
  const tgtById = new Map(tgtBuckets.map((b) => [b.id, b]));
  for (const b of srcBuckets) {
    if (!tgtById.has(b.id)) fatal(`Target missing bucket ${b.id}. Run ensure-buckets first.`);
  }

  for (const b of srcBuckets) {
    console.log(`bucket: ${b.id}`);
    const allKeys = await listAllObjectKeys(source, b.id);
    console.log(`- objects on source: ${allKeys.length}`);

    for (const key of allKeys) {
      const exists = await objectExists(staging, b.id, key);
      if (exists) continue;
      await copyObject(source, staging, b.id, key);
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }

  console.log("done");
  process.exit(0);
}

if (cmd === "verify-counts") {
  const srcBuckets = await listBuckets(source);
  const tgtBuckets = await listBuckets(staging);
  const tgtById = new Map(tgtBuckets.map((b) => [b.id, b]));

  const results = [];
  for (const b of srcBuckets) {
    if (!tgtById.has(b.id)) {
      results.push({ bucket: b.id, source_count: null, target_count: null, ok: false, error: "missing_on_target" });
      continue;
    }
    const srcCount = await countObjects(source, b.id);
    const tgtCount = await countObjects(staging, b.id);
    results.push({ bucket: b.id, source_count: srcCount, target_count: tgtCount, ok: srcCount === tgtCount });
  }

  console.log(JSON.stringify({ results }, null, 2));
  const allOk = results.every((r) => r.ok);
  process.exit(allOk ? 0 : 2);
}

if (cmd === "verify-samples") {
  const srcBuckets = await listBuckets(source);
  const results = [];
  for (const b of srcBuckets) {
    const keys = await listAllObjectKeys(source, b.id);
    const sample = keys.slice(0, perBucketSamples);
    for (const key of sample) {
      const r = await verifyObjectDownload(staging, b.id, key);
      results.push({ bucket: b.id, key, ...r });
    }
  }
  console.log(JSON.stringify({ per_bucket: perBucketSamples, results }, null, 2));
  const allOk = results.every((r) => r.ok === true);
  process.exit(allOk ? 0 : 2);
}

if (cmd === "diff-keys") {
  if (!diffBucket) fatal("Missing --bucket <name>");
  const srcKeys = await listAllObjectKeys(source, diffBucket);
  const tgtKeys = await listAllObjectKeys(staging, diffBucket);

  const srcSet = new Set(srcKeys);
  const tgtSet = new Set(tgtKeys);

  const missingOnTarget = srcKeys.filter((k) => !tgtSet.has(k));
  const extraOnTarget = tgtKeys.filter((k) => !srcSet.has(k));

  console.log(JSON.stringify({
    bucket: diffBucket,
    source_count: srcKeys.length,
    target_count: tgtKeys.length,
    missing_on_target_count: missingOnTarget.length,
    extra_on_target_count: extraOnTarget.length,
    missing_on_target_sample: missingOnTarget.slice(0, diffLimit),
    extra_on_target_sample: extraOnTarget.slice(0, diffLimit),
  }, null, 2));
  process.exit(missingOnTarget.length === 0 && extraOnTarget.length === 0 ? 0 : 2);
}

fatal(`Unknown command: ${cmd}`);

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) fatal(`Missing env var ${name}`);
  return v.trim();
}

function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

function getFlagNumber(args, flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx === -1) return defaultValue;
  const raw = args[idx + 1];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) fatal(`Invalid ${flag} value: ${raw}`);
  return n;
}

function getFlagString(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const raw = args[idx + 1];
  if (!raw) fatal(`Missing ${flag} value`);
  return String(raw);
}

function storageClient(baseUrl, serviceRoleKey) {
  return {
    baseUrl,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
  };
}

async function reqJson(client, method, urlPath, body) {
  const res = await fetch(`${client.baseUrl}${urlPath}`, {
    method,
    headers: {
      ...client.headers,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${urlPath} failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`);
  }
  return await res.json();
}

async function reqStream(client, method, urlPath) {
  const res = await fetch(`${client.baseUrl}${urlPath}`, {
    method,
    headers: { ...client.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${urlPath} failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`);
  }
  return res;
}

async function listBuckets(client) {
  return await reqJson(client, "GET", "/storage/v1/bucket", undefined);
}

async function createBucket(client, id, isPublic) {
  await reqJson(client, "POST", "/storage/v1/bucket", { id, name: id, public: !!isPublic });
}

async function updateBucket(client, id, isPublic) {
  await reqJson(client, "PUT", `/storage/v1/bucket/${encodeURIComponent(id)}`, { public: !!isPublic });
}

async function listObjectKeysPage(client, bucket, prefix) {
  // Supabase Storage list endpoint expects POST JSON.
  const body = { prefix: prefix ?? "", limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } };
  const out = [];
  for (;;) {
    const page = await reqJson(client, "POST", `/storage/v1/object/list/${encodeURIComponent(bucket)}`, body);
    out.push(...page);
    if (page.length < body.limit) break;
    body.offset += body.limit;
  }
  return out;
}

async function listAllObjectKeys(client, bucket) {
  // Storage list returns both objects and "folders" (prefixes). Folders show up as
  // entries with id=null; to traverse them we re-list using prefix "<folder>/".
  const keys = [];
  const queue = [""];
  const seenPrefix = new Set(queue);

  while (queue.length) {
    const prefix = queue.shift();
    const entries = await listObjectKeysPage(client, bucket, prefix);

    for (const entry of entries) {
      const name = String(entry?.name ?? "");
      if (!name) continue;

      const isFolder = entry?.id == null;
      if (isFolder) {
        const nextPrefix = prefix ? `${prefix}${name}/` : `${name}/`;
        if (!seenPrefix.has(nextPrefix)) {
          seenPrefix.add(nextPrefix);
          queue.push(nextPrefix);
        }
        continue;
      }

      const key = prefix ? `${prefix}${name}` : name;
      keys.push(key);
    }
  }

  return keys.sort();
}

async function objectExists(client, bucket, key) {
  const res = await fetch(`${client.baseUrl}/storage/v1/object/info/${encodeURIComponent(bucket)}/${encodeObjectKeyPath(key)}`, {
    method: "GET",
    headers: { ...client.headers },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET object info failed: ${res.status} ${res.statusText}${text ? `\n${text}` : ""}`);
  }
  return true;
}

async function copyObject(sourceClient, targetClient, bucket, key) {
  // Stream download → temp file → upload. Avoids buffering entire object in memory.
  const tmpBase = path.join(tmpdir(), "supabase-storage-copy");
  await mkdir(tmpBase, { recursive: true });
  const tmpFile = path.join(tmpBase, `${createHash("sha256").update(`${bucket}:${key}:${Date.now()}`).digest("hex")}.bin`);

  try {
    // Use a signed URL for private buckets to avoid ambiguous object routes.
    const signed = await signObjectUrl(sourceClient, bucket, key, 60);
    const downloadRes = await fetchSignedDownload(signed, sourceClient);
    await pipeline(downloadRes.body, createWriteStream(tmpFile));

    const uploadRes = await fetch(`${targetClient.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectKeyPath(key)}`, {
      method: "POST",
      headers: {
        ...targetClient.headers,
        "content-type": "application/octet-stream",
        "x-upsert": "false",
      },
      body: createReadStream(tmpFile),
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      throw new Error(`Upload failed ${bucket}/${key}: ${uploadRes.status} ${uploadRes.statusText}${text ? `\n${text}` : ""}`);
    }
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function countObjects(client, bucket) {
  const keys = await listAllObjectKeys(client, bucket);
  return keys.length;
}

async function verifyObjectDownload(client, bucket, key) {
  try {
    const signed = await signObjectUrl(client, bucket, key, 60);
    const res = await fetchSignedDownload(signed, client);
    if (!res.ok) {
      const text = debug ? await res.text().catch(() => "") : "";
      return {
        ok: false,
        signed_url_raw: debug ? signed.signedURL : undefined,
        signed_url_resolved: debug ? res.__resolvedUrl : undefined,
        status: res.status,
        status_text: res.statusText,
        error: debug && text ? text.slice(0, 500) : undefined,
      };
    }
    // Only read a small prefix to prove access.
    const reader = res.body.getReader();
    const { done } = await reader.read();
    // Cancel to avoid transferring entire object.
    try { await reader.cancel(); } catch {}
    return { ok: done === false || done === true };
  } catch (e) {
    return {
      ok: false,
      signed_url_raw: debug ? "<sign failed>" : undefined,
      signed_url_resolved: debug ? "<sign failed>" : undefined,
      error: debug ? String(e) : undefined,
    };
  }
}

function encodeObjectKeyPath(key) {
  // Important: object keys commonly contain '/' which must remain as path separators.
  // Encode each segment individually.
  return String(key)
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function signObjectUrl(client, bucket, key, expiresInSeconds) {
  // POST /object/sign/{bucket}/{path}
  return await reqJson(
    client,
    "POST",
    `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeObjectKeyPath(key)}`,
    { expiresIn: expiresInSeconds }
  );
}

function resolveSignedUrl(client, signedUrl) {
  const raw = String(signedUrl ?? "");
  if (!raw) throw new Error("Signed URL missing from sign response");
  // signedURL may be absolute or relative (e.g. "/storage/v1/object/sign/...").
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) {
    // Some deployments return "/object/sign/..." instead of "/storage/v1/object/sign/...".
    if (raw.startsWith("/object/")) return `${client.baseUrl}/storage/v1${raw}`;
    return `${client.baseUrl}${raw}`;
  }
  // Some responses may omit the leading slash.
  if (raw.startsWith("object/")) return `${client.baseUrl}/storage/v1/${raw}`;
  return `${client.baseUrl}/${raw}`;
}

async function fetchSignedDownload(signed, client) {
  const primary = resolveSignedUrl(client, signed.signedURL);
  const primaryRes = await fetch(primary, { method: "GET" });
  primaryRes.__resolvedUrl = primary;

  // Heuristic fallback: some environments expect downloads from /object/<bucket>/<path>?token=...
  // even when the signer returns /object/sign/... URLs.
  if (!primaryRes.ok) {
    const alt = primary
      .replace("/storage/v1/object/sign/", "/storage/v1/object/")
      .replace("/storage/v1/object/sign/", "/storage/v1/object/");
    if (alt !== primary) {
      const altRes = await fetch(alt, { method: "GET" });
      altRes.__resolvedUrl = alt;
      if (altRes.ok) return altRes;
    }
  }

  return primaryRes;
}
