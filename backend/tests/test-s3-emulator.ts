// LIFESPAN: permanent
// Integration test: the real archive code (src/config/r2.ts with ARCHIVE_PROVIDER=s3 and the real
// ArchivalService) against a bucket that deploy/aws created in a local AWS emulator (moto), signing in as
// the IAM user terraform created, with moto's IAM enforcement on. Run it through deploy/aws/emulator-proof.sh,
// which exports AWS_S3_ENDPOINT, AWS_S3_BUCKET_NAME, AWS_REGION, the admin access variables (AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY) and the IAM user's (APP_ACCESS_KEY_ID, APP_SECRET_ACCESS_KEY), plus REDIS_URL.
// Without an emulator it prints a skip message and exits 0; with REQUIRE_EMULATOR=1 (CI) it fails instead.
// Supabase is served by a small stand-in HTTP server written from the PostgREST docs, so ArchivalService runs for real.
// Run: npm run test:s3-emulator
import http from "node:http";
import {
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.AWS_S3_ENDPOINT;
const bucket = process.env.AWS_S3_BUCKET_NAME;
const region = process.env.AWS_REGION ?? "ap-southeast-2";

async function emulatorUp(url: string | undefined) {
  if (!url) return false;
  try {
    const res = await fetch(`${url}/moto-api/`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

if (!(await emulatorUp(endpoint)) || !bucket) {
  const msg = "SKIP: no AWS emulator reachable (install moto with: pip install moto[server], then run deploy/aws/emulator-proof.sh)";
  if (process.env.REQUIRE_EMULATOR === "1") {
    console.error(`FAIL: REQUIRE_EMULATOR=1 but the emulator or bucket is missing. ${msg}`);
    process.exit(1);
  }
  console.log(msg);
  process.exit(0);
}

const admin = { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "" };
const app = { accessKeyId: process.env.APP_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.APP_SECRET_ACCESS_KEY ?? "" };
if (!app.accessKeyId || !app.secretAccessKey) {
  console.error("FAIL: APP_ACCESS_KEY_ID and APP_SECRET_ACCESS_KEY (the IAM user terraform created) are required");
  process.exit(1);
}

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};
const outcome = async (p: Promise<unknown>) => {
  try {
    await p;
    return { ok: true, name: "", status: 200 };
  } catch (e: any) {
    return { ok: false, name: String(e.name), status: Number(e.$metadata?.httpStatusCode ?? 0) };
  }
};
const denied = async (name: string, p: Promise<unknown>) => {
  const r = await outcome(p);
  check(name, !r.ok && r.status === 403, `${r.name} ${r.status}`);
};

// moto checks IAM policies only after this many unauthenticated calls; 0 turns checking on for every call.
const enforce = async (on: boolean) => {
  const res = await fetch(`${endpoint}/moto-api/reset-auth`, { method: "POST", headers: { "content-type": "text/plain" }, body: on ? "0" : "inf" });
  if (!res.ok) throw new Error(`reset-auth failed: ${res.status}`);
};

// A stand-in for the Supabase REST API with three finished runs, one of which refuses the update (to exercise the rollback).
const day = 86400000;
const runs = [1, 2, 3].map((n) => ({
  id: `run-${Date.now()}-${n}`,
  workflow_id: "wf-1",
  user_id: "user-1111",
  status: "completed",
  started_at: new Date(Date.now() - 40 * day).toISOString(),
  completed_at: new Date(Date.now() - 40 * day + 5000).toISOString(),
  duration: 5000,
  logs: [{ level: "info", message: `step ${n} done` }],
  extracted_data: { rows: n },
  error_message: null,
  archived: false,
  r2_key: null as string | null,
}));
const failingRunId = runs[2].id;
const stand = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://stand-in");
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const table = url.pathname.replace("/rest/v1/", "");
    const idFilter = url.searchParams.get("id")?.replace("eq.", "");
    const send = (code: number, body?: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (table === "executions" && req.method === "GET") {
      if (idFilter) {
        const row = runs.find((r) => r.id === idFilter);
        return row ? send(200, String(req.headers.accept).includes("pgrst.object") ? row : [row]) : send(406, { code: "PGRST116", message: "no rows" });
      }
      return send(200, runs.filter((r) => !r.archived).map((r) => ({ id: r.id })));
    }
    if (table === "executions" && req.method === "PATCH" && idFilter) {
      if (idFilter === failingRunId) return send(500, { code: "XX000", message: "update refused by the stand-in" });
      Object.assign(runs.find((r) => r.id === idFilter) ?? {}, JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      return send(204);
    }
    if (table === "execution_logs" && req.method === "DELETE") return send(204);
    return send(404, { message: `stand-in has no ${req.method} ${url.pathname}` });
  });
});
await new Promise<void>((r) => stand.listen(0, "127.0.0.1", r));
const standPort = (stand.address() as { port: number }).port;

const adminClient = new S3Client({ region, endpoint, forcePathStyle: true, credentials: admin });

// Empty the bucket one version at a time (moto 5.2.5 fails a bulk delete that includes a delete marker,
// so force_destroy alone cannot empty a bucket that holds one). Returns how many versions and markers remain.
const emptyBucket = async () => {
  const all = await adminClient.send(new ListObjectVersionsCommand({ Bucket: bucket }));
  for (const o of [...(all.Versions ?? []), ...(all.DeleteMarkers ?? [])]) {
    await adminClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key, VersionId: o.VersionId }));
  }
  const left = await adminClient.send(new ListObjectVersionsCommand({ Bucket: bucket }));
  return (left.Versions?.length ?? 0) + (left.DeleteMarkers?.length ?? 0);
};

// The archive modules read their settings when first imported, so set them first.
process.env.ARCHIVE_PROVIDER = "s3";
process.env.SUPABASE_URL = `http://127.0.0.1:${standPort}`;
process.env.SUPABASE_ANON_KEY = "stand-in";
process.env.SUPABASE_SERVICE_KEY = "stand-in";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.AWS_ACCESS_KEY_ID = app.accessKeyId;
process.env.AWS_SECRET_ACCESS_KEY = app.secretAccessKey;

try {
  const r2 = await import("../src/config/r2.js");
  const { ARCHIVE_PREFIX } = await import("../src/config/archiveTarget.js");
  const { archivalService } = await import("../src/services/ArchivalService.js");
  const appClient = r2.r2Client;
  const list = (c: S3Client, prefix?: string) => c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  const body = async (c: S3Client, key: string) => (await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body!.transformToString();

  check("the archive code selected the AWS S3 path", r2.archiveProvider === "s3");
  check("archive storage reports enabled", r2.r2Enabled === true);
  check("the code targets the bucket terraform created", r2.BUCKET_NAME === bucket, r2.BUCKET_NAME);

  // 1. What terraform applied, read back with the admin client
  await enforce(false);
  const versioning = await adminClient.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  check("versioning is Enabled", versioning.Status === "Enabled", String(versioning.Status));
  const enc = await adminClient.send(new GetBucketEncryptionCommand({ Bucket: bucket }));
  check("server-side encryption is AES256", enc.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm === "AES256");
  const pab = (await adminClient.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))).PublicAccessBlockConfiguration;
  check("all four public access blocks are on", !!pab?.BlockPublicAcls && !!pab?.BlockPublicPolicy && !!pab?.IgnorePublicAcls && !!pab?.RestrictPublicBuckets, JSON.stringify(pab));
  const lc = (await adminClient.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))).Rules ?? [];
  check("there is one lifecycle rule and it is enabled", lc.length === 1 && lc[0].Status === "Enabled", JSON.stringify(lc));
  check("the lifecycle rule prefix equals the prefix the code writes under", lc[0]?.Filter?.Prefix === ARCHIVE_PREFIX, JSON.stringify(lc[0]?.Filter));
  check("the lifecycle rule expires archives after 90 days", lc[0]?.Expiration?.Days === 90, JSON.stringify(lc[0]?.Expiration));

  // An object under a different prefix, written by the admin, so the prefix checks below mean something
  const seed = await adminClient.send(new PutObjectCommand({ Bucket: bucket, Key: "other/seed.json", Body: "{\"seed\":true}" }));
  check("a seed object exists under other/", !!seed.VersionId);

  // 2. The app signs in as the IAM user terraform created, with the policy enforced
  await enforce(true);
  try {
    check("connection check passes for the IAM user", (await r2.testR2Connection()) === true);

    const userId = "user-2222";
    const key = `${ARCHIVE_PREFIX}${userId}/manual-${Date.now()}.json`;
    const archive = { id: "manual", status: "completed", logs: [{ level: "info", message: "done" }], extracted_data: { rows: 3 } };
    const up = await r2.uploadToR2(key, JSON.stringify(archive), "application/json");
    check("upload under the archive prefix works and reports the bucket and key", up.bucket === bucket && up.key === key);
    check("list under the archive prefix finds the object", ((await list(appClient, `${ARCHIVE_PREFIX}${userId}/`)).Contents ?? []).some((o) => o.Key === key));
    check("read back matches what was archived", JSON.stringify(JSON.parse((await r2.downloadFromR2(key)).toString("utf-8"))) === JSON.stringify(archive));
    const url = new URL(await r2.getSignedDownloadUrl(key, 60));
    check("a signed URL targets the emulator bucket and key", url.href.includes(`/${bucket}/${key}`), url.href);

    // Version delete inside the prefix is allowed, because the bucket is versioned
    const v = await appClient.send(new PutObjectCommand({ Bucket: bucket, Key: `${ARCHIVE_PREFIX}${userId}/versioned.json`, Body: "v1" }));
    const delVersion = await outcome(appClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${ARCHIVE_PREFIX}${userId}/versioned.json`, VersionId: v.VersionId })));
    check("deleting a version under the archive prefix is allowed", !!v.VersionId && delVersion.ok, `${delVersion.name} ${delVersion.status}`);

    // Everything outside the prefix and every bucket setting is refused
    await denied("put under another prefix is denied (403)", appClient.send(new PutObjectCommand({ Bucket: bucket, Key: "other/x.json", Body: "x" })));
    await denied("get under another prefix is denied (403)", appClient.send(new GetObjectCommand({ Bucket: bucket, Key: "other/seed.json" })));
    await denied("deleting a version under another prefix is denied (403)", appClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: "other/seed.json", VersionId: seed.VersionId })));
    await denied("reading the bucket settings is denied (403)", appClient.send(new GetBucketVersioningCommand({ Bucket: bucket })));
    await denied("deleting the bucket is denied (403)", appClient.send(new DeleteBucketCommand({ Bucket: bucket })));

    // The real ArchivalService, end to end
    const batch = await archivalService.archiveBatch();
    check("archiveBatch picked up all three runs", batch.total === 3, JSON.stringify(batch));
    check("two runs archived and one failed", batch.successful === 2 && batch.failed === 1, JSON.stringify(batch));
    for (const r of batch.results.filter((x) => x.archived)) {
      const run = runs.find((x) => x.id === r.executionId)!;
      const n = run.id.slice(-1);
      check(`archived run ${n} is stored under ${ARCHIVE_PREFIX}<user>/<run>.json`, r.r2Key === `${ARCHIVE_PREFIX}${run.user_id}/${run.id}.json`, String(r.r2Key));
      const stored = JSON.parse(await body(appClient, r.r2Key!));
      check(`archived run ${n} reads back under its real key with its logs and data`, stored.id === run.id && stored.logs[0].message === `step ${n} done` && stored.extracted_data.rows === Number(n), JSON.stringify(stored));
      check(`run ${n} row now points at the archive and holds no logs`, run.archived === true && run.r2_key === r.r2Key && run.logs.length === 0);
    }
    const failedRun = batch.results.find((x) => !x.archived);
    check("the run whose row update failed was rolled back out of the bucket", failedRun?.executionId === failingRunId && (await outcome(r2.downloadFromR2(`${ARCHIVE_PREFIX}user-1111/${failingRunId}.json`))).name === "NoSuchKey");
  } finally {
    await enforce(false);
  }

  // 3. Admin view of what is in the bucket
  const archived = (await list(adminClient, `${ARCHIVE_PREFIX}user-1111/`)).Contents ?? [];
  check("the bucket holds exactly the two archived runs under the user's prefix", archived.length === 2, JSON.stringify(archived.map((o) => o.Key)));
  const other = (await list(adminClient, "other/")).Contents ?? [];
  check("other/ holds only the seed object, so the denied writes wrote nothing", other.length === 1 && other[0].Key === "other/seed.json", JSON.stringify(other.map((o) => o.Key)));
  check("the seed object is unchanged", (await body(adminClient, "other/seed.json")) === "{\"seed\":true}");

  check("every version and delete marker was removed", (await emptyBucket()) === 0);
} finally {
  await enforce(false).catch(() => {});
  await emptyBucket().catch(() => {}); // also when a check threw, so terraform destroy finds nothing to remove
  stand.close();
}

// moto does not evaluate the s3:prefix condition on the list statement, so "list with no prefix is denied" can
// only be shown on real AWS; the condition itself is asserted in test-aws-terraform.ts from the plan JSON.
console.log(failed === 0 ? `\nAll ${passed} emulator checks passed` : `\n${failed} of ${passed + failed} emulator checks failed`);
process.exit(failed === 0 ? 0 : 1);
