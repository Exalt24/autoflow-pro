import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { CHANNELS, dayOf, isoOf, parseTimestamp, type Reading } from "./schema.js";
import type { QuarantineEntry } from "./store.js";
import { ROLLUP_COLUMNS, type Column, type ResolutionName, type RollupRow } from "./rollup.js";

// The lake: where readings, rollups and quarantined input are stored as JSON lines, one file per partition, in the
// layout the Glue tables in deploy/athena/telemetry.tf project:
//
//   telemetry/readings/asset=<id>/dt=YYYY-MM-DD/hour=HH/part-<batch>.jsonl
//   telemetry/rollups_5m/asset=<id>/dt=YYYY-MM-DD/rollup.jsonl
//   telemetry/rollups_1h/asset=<id>/dt=YYYY-MM-DD/rollup.jsonl
//   telemetry/quarantine/dt=YYYY-MM-DD/part-<batch>.jsonl
//
// The day and hour are UTC. A reading part file is named by the batch that wrote it, so writing a batch again replaces
// the same file with the same lines. A rollup file holds a whole day of one asset and is replaced when a bucket in it
// changes.

export const TELEMETRY_PREFIX = "telemetry/";

// One source of truth for the layout. {asset}, {dt} and {hour} are the Glue partition keys; the Terraform check turns
// each template into the storage.location.template of its table.
export const PARTITION_TEMPLATES = {
  readings: `${TELEMETRY_PREFIX}readings/asset={asset}/dt={dt}/hour={hour}/`,
  rollup_5m: `${TELEMETRY_PREFIX}rollups_5m/asset={asset}/dt={dt}/`,
  rollup_1h: `${TELEMETRY_PREFIX}rollups_1h/asset={asset}/dt={dt}/`,
  quarantine: `${TELEMETRY_PREFIX}quarantine/dt={dt}/`,
} as const;

export const READING_COLUMNS: Column[] = [
  { name: "asset_id", type: "string" },
  { name: "ts", type: "string" },
  ...CHANNELS.map((c): Column => ({ name: c, type: "double" })),
];

export const QUARANTINE_COLUMNS: Column[] = [
  { name: "reason", type: "string" },
  { name: "detail", type: "string" },
  { name: "asset_id", type: "string" },
  { name: "ts", type: "string" },
  { name: "raw", type: "string" },
];

const fill = (template: string, vars: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]);
const BATCH_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET = /^[A-Za-z0-9_-]{1,64}$/;

function checkBatchId(batchId: string): string {
  if (!BATCH_ID.test(batchId)) throw new RangeError("batchId may hold letters, digits, _ and - only (1 to 64)");
  return batchId;
}

export function readingsDir(assetId: string, ts: number): string {
  if (!ASSET.test(assetId)) throw new RangeError(`not an asset id: ${assetId}`);
  return fill(PARTITION_TEMPLATES.readings, { asset: assetId, dt: dayOf(ts), hour: isoOf(ts).slice(11, 13) });
}

export const readingsKey = (assetId: string, ts: number, batchId: string): string => `${readingsDir(assetId, ts)}part-${checkBatchId(batchId)}.jsonl`;

export function rollupKey(res: ResolutionName, assetId: string, day: string): string {
  if (!ASSET.test(assetId)) throw new RangeError(`not an asset id: ${assetId}`);
  return `${fill(res === "5m" ? PARTITION_TEMPLATES.rollup_5m : PARTITION_TEMPLATES.rollup_1h, { asset: assetId, dt: day })}rollup.jsonl`;
}

export const quarantineKey = (day: string, batchId: string): string => `${fill(PARTITION_TEMPLATES.quarantine, { dt: day })}part-${checkBatchId(batchId)}.jsonl`;

// ---------------------------------------------------------------- the store behind the lake

export interface LakeStore {
  /** Replace the object at key. A reader sees the old content or the new content, never a half written file. */
  put(key: string, body: string): Promise<void>;
  /** The object's text, or null when there is none. */
  get(key: string): Promise<string | null>;
  /** Every key that starts with prefix, sorted. */
  list(prefix: string): Promise<string[]>;
}

function safeKey(key: string): string {
  if (key === "" || key.startsWith("/") || key.includes("\\") || key.split("/").some((p) => p === ".." || p === "." || p === "")) {
    throw new RangeError(`not a lake key: ${key}`);
  }
  return key;
}

/** A local directory. A write goes to a temporary file in the same folder and is renamed over the target. */
export class FsLakeStore implements LakeStore {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const full = resolve(join(this.root, ...safeKey(key).split("/")));
    if (!full.startsWith(this.root + sep)) throw new RangeError(`key leaves the lake: ${key}`);
    return full;
  }

  async put(key: string, body: string): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${randomBytes(6).toString("hex")}`;
    await writeFile(tmp, body, "utf8");
    try {
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dirKey: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(join(this.root, ...dirKey.split("/").filter(Boolean)), { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      for (const entry of entries) {
        const key = `${dirKey}${entry.name}`;
        if (entry.isDirectory()) await walk(`${key}/`);
        else if (!entry.name.includes(".tmp-") && key.startsWith(prefix)) out.push(key);
      }
    };
    await walk(prefix.slice(0, prefix.lastIndexOf("/") + 1));
    return out.sort();
  }
}

export class MemoryLakeStore implements LakeStore {
  readonly objects = new Map<string, string>();
  async put(key: string, body: string): Promise<void> {
    this.objects.set(safeKey(key), body);
  }
  async get(key: string): Promise<string | null> {
    return this.objects.get(safeKey(key)) ?? null;
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/**
 * The same interface over an S3 bucket, with the calls the AWS SDK for S3 documents: PutObject replaces an object
 * atomically, GetObject answers NoSuchKey for a missing one, ListObjectsV2 pages with a continuation token.
 */
export class S3LakeStore implements LakeStore {
  constructor(private s3: { send(command: unknown): Promise<unknown> }, private bucket: string) {}

  async put(key: string, body: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: safeKey(key), Body: body, ContentType: "application/x-ndjson" }));
  }

  async get(key: string): Promise<string | null> {
    try {
      const res = (await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }))) as { Body?: { transformToString(): Promise<string> } };
      return res.Body ? await res.Body.transformToString() : "";
    } catch (e) {
      const err = e as { name?: string; Code?: string };
      if (err.name === "NoSuchKey" || err.Code === "NoSuchKey") return null;
      throw e;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = (await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }))) as {
        Contents?: { Key?: string }[];
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }
}

// ---------------------------------------------------------------- serialising

export function readingToLine(r: Reading): string {
  return JSON.stringify({ asset_id: r.assetId, ts: isoOf(r.ts), power_kw: r.power_kw, voltage_v: r.voltage_v, temp_c: r.temp_c });
}

export function readingFromLine(line: string): Reading {
  const o = JSON.parse(line) as Record<string, unknown>;
  const ts = parseTimestamp(o.ts);
  if (typeof ts === "string" || typeof o.asset_id !== "string" || typeof o.power_kw !== "number") {
    throw new Error(`corrupt reading line in the lake: ${line.slice(0, 120)}`);
  }
  const opt = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return { assetId: o.asset_id, ts, power_kw: o.power_kw, voltage_v: opt(o.voltage_v), temp_c: opt(o.temp_c) };
}

export function quarantineToLine(e: QuarantineEntry): string {
  return JSON.stringify({ reason: e.reason, detail: e.detail, asset_id: e.assetId, ts: e.ts, raw: e.raw });
}

export function quarantineFromLine(line: string): QuarantineEntry {
  const o = JSON.parse(line) as Record<string, unknown>;
  return { reason: o.reason as QuarantineEntry["reason"], detail: String(o.detail), assetId: (o.asset_id as string | null) ?? null, ts: (o.ts as string | null) ?? null, raw: String(o.raw) };
}

const lines = (rows: string[]): string => (rows.length ? `${rows.join("\n")}\n` : "");
const parseLines = (text: string): string[] => text.split("\n").filter((l) => l !== "");

// ---------------------------------------------------------------- writing

/** One file per (asset, day, hour) that the readings touch, lines in time order. Returns the keys written. */
export async function writeReadings(lake: LakeStore, readings: Reading[], batchId: string): Promise<string[]> {
  const groups = new Map<string, Reading[]>();
  for (const r of readings) {
    const key = readingsKey(r.assetId, r.ts, batchId);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const rows = groups.get(key) as Reading[];
    rows.sort((a, b) => a.ts - b.ts);
    await lake.put(key, lines(rows.map(readingToLine)));
  }
  return keys;
}

export async function writeQuarantine(lake: LakeStore, day: string, entries: QuarantineEntry[], batchId: string): Promise<string | null> {
  if (entries.length === 0) return null;
  const key = quarantineKey(day, batchId);
  await lake.put(key, lines(entries.map(quarantineToLine)));
  return key;
}

export function rollupBody(rows: RollupRow[]): string {
  return lines(rows.map((r) => JSON.stringify(Object.fromEntries(ROLLUP_COLUMNS.map((c) => [c.name, r[c.name]])))));
}

export async function writeRollupDay(lake: LakeStore, res: ResolutionName, assetId: string, day: string, rows: RollupRow[]): Promise<string> {
  const key = rollupKey(res, assetId, day);
  await lake.put(key, rollupBody(rows));
  return key;
}

// ---------------------------------------------------------------- reading

export async function readReadings(lake: LakeStore, prefix = `${TELEMETRY_PREFIX}readings/`): Promise<Reading[]> {
  const out: Reading[] = [];
  for (const key of await lake.list(prefix)) {
    const text = await lake.get(key);
    if (text === null) continue;
    for (const line of parseLines(text)) out.push(readingFromLine(line));
  }
  return out;
}

export async function readQuarantine(lake: LakeStore): Promise<QuarantineEntry[]> {
  const out: QuarantineEntry[] = [];
  for (const key of await lake.list(`${TELEMETRY_PREFIX}quarantine/`)) {
    const text = await lake.get(key);
    if (text === null) continue;
    for (const line of parseLines(text)) out.push(quarantineFromLine(line));
  }
  return out;
}

export async function readRollupDay(lake: LakeStore, res: ResolutionName, assetId: string, day: string): Promise<RollupRow[]> {
  const text = await lake.get(rollupKey(res, assetId, day));
  return text === null ? [] : parseLines(text).map((l) => JSON.parse(l) as RollupRow);
}
