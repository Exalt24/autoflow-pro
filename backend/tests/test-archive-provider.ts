// LIFESPAN: permanent
// Unit tests for the archive provider switch (ARCHIVE_PROVIDER=r2|s3). No network, no env files.
// Run: npm run test:archive-provider
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ARCHIVE_PREFIX,
  parseArchiveProvider,
  resolveArchiveTarget,
} from "../src/config/archiveTarget.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const r2Vars = {
  CLOUDFLARE_R2_ACCOUNT_ID: "acct123",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "id",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "value",
  CLOUDFLARE_R2_BUCKET_NAME: "r2-bucket",
};

// r2 stays the default
const unset = resolveArchiveTarget(r2Vars);
check("no ARCHIVE_PROVIDER selects r2", unset.provider === "r2");
check("r2 default keeps the Cloudflare endpoint", unset.client.endpoint === "https://acct123.r2.cloudflarestorage.com");
check("r2 default keeps region auto", unset.client.region === "auto");
check("r2 default keeps the R2 bucket setting", unset.bucket === "r2-bucket");
check("r2 default is enabled with all three R2 values", unset.enabled === true);
check("r2 default is disabled without R2 values", resolveArchiveTarget({}).enabled === false);
check("an empty ARCHIVE_PROVIDER selects r2", resolveArchiveTarget({ ...r2Vars, ARCHIVE_PROVIDER: "" }).provider === "r2");
check("ARCHIVE_PROVIDER=r2 selects r2", resolveArchiveTarget({ ...r2Vars, ARCHIVE_PROVIDER: "r2" }).provider === "r2");
check(
  "R2 values are ignored when s3 is selected",
  resolveArchiveTarget({ ...r2Vars, ARCHIVE_PROVIDER: "s3" }).enabled === false,
);

// s3 uses the AWS path
const s3 = resolveArchiveTarget({ ARCHIVE_PROVIDER: "s3", AWS_S3_BUCKET_NAME: "aws-bucket", AWS_REGION: "eu-west-1" });
check("ARCHIVE_PROVIDER=s3 selects s3", s3.provider === "s3");
check("s3 uses the configured region", s3.client.region === "eu-west-1");
check("s3 sets no endpoint so the SDK resolves AWS", s3.client.endpoint === undefined);
check("s3 uses virtual-hosted style without an endpoint", s3.client.forcePathStyle === undefined);
check("s3 uses the AWS bucket setting", s3.bucket === "aws-bucket");
check("s3 is enabled when the bucket is set", s3.enabled === true);
check("s3 is disabled without a bucket", resolveArchiveTarget({ ARCHIVE_PROVIDER: "s3" }).enabled === false);
check("s3 region defaults to us-east-1", resolveArchiveTarget({ ARCHIVE_PROVIDER: "s3" }).client.region === "us-east-1");
check(
  "AWS_DEFAULT_REGION is used when AWS_REGION is unset",
  resolveArchiveTarget({ ARCHIVE_PROVIDER: "s3", AWS_DEFAULT_REGION: "ap-southeast-1" }).client.region === "ap-southeast-1",
);
const emu = resolveArchiveTarget({ ARCHIVE_PROVIDER: "s3", AWS_S3_ENDPOINT: "http://localhost:5000" });
check("s3 with an endpoint override uses it", emu.client.endpoint === "http://localhost:5000");
check("s3 with an endpoint override uses path-style URLs", emu.client.forcePathStyle === true);
check("s3 notices name AWS, not R2", /AWS S3/.test(s3.notConfiguredMessage) && !/R2/.test(s3.notConfiguredMessage));
check("r2 notice still names R2", /R2 storage is not configured/.test(unset.notConfiguredMessage));

// the provider value is validated
check("ARCHIVE_PROVIDER=S3 with spaces is accepted", parseArchiveProvider(" S3 ") === "s3");
check("a bad ARCHIVE_PROVIDER is rejected", throws(() => resolveArchiveTarget({ ARCHIVE_PROVIDER: "gcs" })));
check("a near miss like s33 is rejected", throws(() => parseArchiveProvider("s33")));
check(
  "the rejection names the setting and the allowed values",
  (() => {
    try {
      parseArchiveProvider("azure");
    } catch (e: any) {
      return e.message.includes("ARCHIVE_PROVIDER") && e.message.includes('"r2" or "s3"');
    }
    return false;
  })(),
);

// the real SDK client, built from the s3 config, resolves the AWS endpoint
const fakeAccess = { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "example" };
const signed = async (cfg: ConstructorParameters<typeof S3Client>[0], bucket: string) =>
  new URL(await getSignedUrl(new S3Client(cfg), new GetObjectCommand({ Bucket: bucket, Key: `${ARCHIVE_PREFIX}u/1.json` }), { expiresIn: 60 }));

const awsUrl = await signed({ ...s3.client, credentials: fakeAccess }, "aws-bucket");
check("the s3 client targets the regional AWS endpoint", awsUrl.host === "aws-bucket.s3.eu-west-1.amazonaws.com", awsUrl.host);
const emuUrl = await signed({ ...emu.client, credentials: fakeAccess }, "aws-bucket");
check("the emulator override targets the override host", emuUrl.host === "localhost:5000" && emuUrl.pathname.startsWith("/aws-bucket/"), emuUrl.href);
const r2Url = await signed({ ...unset.client }, "r2-bucket");
check("the r2 client still targets Cloudflare", r2Url.host.endsWith("r2.cloudflarestorage.com"), r2Url.host);

check("the archive prefix matches the key ArchivalService writes", ARCHIVE_PREFIX === "executions/");

console.log(failed === 0 ? `\nAll ${passed} archive provider checks passed` : `\n${failed} of ${passed + failed} archive provider checks failed`);
process.exit(failed === 0 ? 0 : 1);
