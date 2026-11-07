// The telemetry reading and its validation. A reading that fails any rule here is never loaded: the store sets it aside
// in the quarantine list with the rule that refused it (see store.ts).
//
// Wire format (one JSON object per reading, snake_case like the files the lake writes):
//   { "asset_id": "pv-001", "ts": "2026-11-06T10:15:00Z", "power_kw": 3.2, "voltage_v": 612.5, "temp_c": 41.0 }
// ts must be ISO 8601 with an explicit zone (Z or +hh:mm); a time with no zone is ambiguous and is refused.

export const CHANNELS = ["power_kw", "voltage_v", "temp_c"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface ChannelSpec {
  min: number;
  max: number;
  required: boolean;
}

// A solar asset cannot produce negative power, so a negative power_kw is a sensor fault, not a value. Ranges are
// physical limits, not alarm limits: they only catch values that cannot be real.
export const CHANNEL_SPECS: Record<Channel, ChannelSpec> = {
  power_kw: { min: 0, max: 10000, required: true },
  voltage_v: { min: 0, max: 2000, required: false },
  temp_c: { min: -60, max: 150, required: false },
};

export interface Reading {
  assetId: string;
  /** UTC instant in epoch milliseconds. */
  ts: number;
  power_kw: number;
  voltage_v: number | null;
  temp_c: number | null;
}

export type RejectReason =
  | "invalid_shape"
  | "unknown_field"
  | "invalid_asset_id"
  | "invalid_timestamp"
  | "future_timestamp"
  | "missing_value"
  | "invalid_value"
  | "out_of_range"
  | "conflicting_duplicate"
  | "too_late";

export const REJECT_REASONS: RejectReason[] = [
  "invalid_shape",
  "unknown_field",
  "invalid_asset_id",
  "invalid_timestamp",
  "future_timestamp",
  "missing_value",
  "invalid_value",
  "out_of_range",
  "conflicting_duplicate",
  "too_late",
];

export type Validation = { ok: true; reading: Reading } | { ok: false; reason: RejectReason; detail: string };

export interface ValidateOptions {
  /** The ingest clock. A reading further ahead of it than maxFutureMs is refused, so one wrong clock cannot move a watermark. */
  nowMs: number;
  maxFutureMs: number;
}

const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_KEYS = new Set<string>(["asset_id", "ts", ...CHANNELS]);
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;
export const MIN_TS = Date.UTC(2000, 0, 1);

const bad = (reason: RejectReason, detail: string): Validation => ({ ok: false, reason, detail });

/** Epoch milliseconds for an ISO 8601 time with a zone, or a string saying what is wrong with it. */
export function parseTimestamp(value: unknown): number | string {
  if (typeof value !== "string") return "ts must be a string";
  const m = ISO.exec(value);
  if (!m) return "ts must be ISO 8601 with a zone, like 2026-11-06T10:15:00Z";
  const [, y, mo, d, h, mi, s, frac, zulu, sign, oh, om] = m;
  const ms = frac ? Number(frac.padEnd(3, "0")) : 0;
  const local = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  // Date.UTC rolls an impossible date into the next month (2026-02-30 becomes March 2), so a month that moved is the tell.
  // The time of day is range checked by hand because 24:00 rolls into the next day without moving the month.
  const back = new Date(local);
  const real =
    back.getUTCFullYear() === Number(y) &&
    back.getUTCMonth() === Number(mo) - 1 &&
    Number(h) <= 23 &&
    Number(mi) <= 59 &&
    Number(s) <= 59;
  if (!real) return "ts is not a real calendar time";
  if (zulu) return local;
  if (Number(oh) > 23 || Number(om) > 59) return "ts has an impossible zone offset";
  const offset = (Number(oh) * 60 + Number(om)) * 60_000;
  return sign === "-" ? local + offset : local - offset;
}

export function validateReading(raw: unknown, opts: ValidateOptions): Validation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return bad("invalid_shape", "a reading must be a JSON object");
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(key)) return bad("unknown_field", `unknown field "${key}"`);
  }
  const assetId = o.asset_id;
  if (typeof assetId !== "string" || !ASSET_ID.test(assetId)) {
    return bad("invalid_asset_id", "asset_id must be 1 to 64 letters, digits, _ or -");
  }
  const ts = parseTimestamp(o.ts);
  if (typeof ts === "string") return bad("invalid_timestamp", ts);
  if (ts < MIN_TS) return bad("invalid_timestamp", "ts is before 2000-01-01");
  if (ts > opts.nowMs + opts.maxFutureMs) return bad("future_timestamp", "ts is ahead of the ingest clock by more than the allowed skew");
  const values: Record<Channel, number | null> = { power_kw: 0, voltage_v: null, temp_c: null };
  for (const ch of CHANNELS) {
    const spec = CHANNEL_SPECS[ch];
    const v = o[ch];
    if (v === undefined || v === null) {
      if (spec.required) return bad("missing_value", `${ch} is required`);
      values[ch] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return bad("invalid_value", `${ch} must be a finite number`);
    if (v < spec.min || v > spec.max) return bad("out_of_range", `${ch} ${v} is outside ${spec.min} to ${spec.max}`);
    values[ch] = v;
  }
  return { ok: true, reading: { assetId, ts, power_kw: values.power_kw as number, voltage_v: values.voltage_v, temp_c: values.temp_c } };
}

export function sameValues(a: Reading, b: Reading): boolean {
  return a.power_kw === b.power_kw && a.voltage_v === b.voltage_v && a.temp_c === b.temp_c;
}

export function isoOf(ts: number): string {
  return new Date(ts).toISOString();
}

export function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
