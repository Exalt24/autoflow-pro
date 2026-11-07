// LIFESPAN: permanent
// A measured load run: generated solar telemetry through ingest and rollup, then written to a local lake folder and
// read back. Prints the real numbers; docs/test-runs/2026-11-07-telemetry-load.txt is this script's output.
// Defaults: 120 assets x one UTC day at one reading per 10 s = 1,036,800 readings plus the planted defects, in batches of 5000.
// Run: npm run telemetry:load   (LOAD_ASSETS, LOAD_INTERVAL_MS, LOAD_BATCH override the defaults)
import { cpus, platform, release } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSolarDay } from "../src/telemetry/generator.js";
import { ReadingStore } from "../src/telemetry/store.js";
import { RESOLUTIONS, RollupIndex } from "../src/telemetry/rollup.js";
import { FsLakeStore, readReadings, readQuarantine, writeQuarantine, writeReadings, writeRollupDay } from "../src/telemetry/lake.js";

const ASSETS = Number(process.env.LOAD_ASSETS ?? 120);
const INTERVAL = Number(process.env.LOAD_INTERVAL_MS ?? 10_000);
const BATCH = Number(process.env.LOAD_BATCH ?? 5000);
const DAY = "2026-11-06";
const LATENESS = 15 * 60_000;
const NOW = Date.parse("2026-11-07T00:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const secs = (ns: bigint) => Number(ns) / 1e9;
const fmt = (n: number) => n.toLocaleString("en-US");

console.log(`# telemetry load run, ${new Date().toISOString().slice(0, 10)}`);
console.log(`# node ${process.version}, ${platform()} ${release()}, ${cpus()[0]?.model.trim()} x ${cpus().length}`);
console.log(`# ${ASSETS} assets, one UTC day (${DAY}) each, one reading per ${INTERVAL / 1000} s, batches of ${BATCH}, allowed lateness ${LATENESS / 60000} min`);

const store = new ReadingStore({ allowedLatenessMs: LATENESS, maxFutureMs: 5 * 60_000 });
const index = new RollupIndex(store, { expectedIntervalMs: INTERVAL });

let received = 0;
let accepted = 0;
let duplicates = 0;
let lateMerged = 0;
const reasons: Record<string, number> = {};
let expectedAccepted = 0;
let expectedRows5 = 0;
let expectedRows1 = 0;
const independentEnergy = new Map<string, number>();
let genNs = 0n;
let ingestNs = 0n;
let rollupNs = 0n;

for (let a = 0; a < ASSETS; a++) {
  const assetId = `pv-${String(a + 1).padStart(3, "0")}`;
  let t = process.hrtime.bigint();
  const day = generateSolarDay({ assetId, day: DAY, intervalMs: INTERVAL, seed: 7, allowedLatenessMs: LATENESS });
  genNs += process.hrtime.bigint() - t;
  expectedAccepted += day.expected.accepted;

  // The check value, computed apart from the code under test: a plain trapezoid sum over the clean readings.
  let e = 0;
  for (let i = 0; i + 1 < day.clean.length; i++) {
    const dt = day.clean[i + 1].ts - day.clean[i].ts;
    if (dt <= INTERVAL * 1.5) e += ((day.clean[i].power_kw + day.clean[i + 1].power_kw) / 2) * (dt / 3_600_000);
  }
  independentEnergy.set(assetId, e);
  expectedRows5 += new Set(day.clean.map((r) => Math.floor(r.ts / 300_000))).size;
  expectedRows1 += new Set(day.clean.map((r) => Math.floor(r.ts / 3_600_000))).size;

  for (let i = 0; i < day.raw.length; i += BATCH) {
    const slice = day.raw.slice(i, i + BATCH);
    t = process.hrtime.bigint();
    const staged = store.stage(slice, NOW);
    const inserted = store.apply(staged);
    ingestNs += process.hrtime.bigint() - t;
    t = process.hrtime.bigint();
    index.markInserted(inserted);
    index.flush();
    rollupNs += process.hrtime.bigint() - t;
    received += staged.received;
    accepted += staged.accepted.length;
    duplicates += staged.duplicates;
    lateMerged += staged.lateMerged;
    for (const [k, v] of Object.entries(staged.reasons)) reasons[k] = (reasons[k] ?? 0) + (v as number);
  }
}

const ingestRollupS = secs(ingestNs + rollupNs);
console.log("");
console.log(`readings generated and sent:      ${fmt(received)} (${fmt(accepted)} stored, ${fmt(duplicates)} duplicates, ${fmt(lateMerged)} late and merged, ${fmt(Object.values(reasons).reduce((x, y) => x + y, 0))} quarantined)`);
console.log(`generation:                       ${secs(genNs).toFixed(2)} s (not counted below)`);
console.log(`ingest (validate, dedupe, merge): ${secs(ingestNs).toFixed(2)} s`);
console.log(`rollup (5 min and 1 hour):        ${secs(rollupNs).toFixed(2)} s`);
console.log(`ingest + rollup elapsed:          ${ingestRollupS.toFixed(2)} s`);
console.log(`throughput:                       ${fmt(Math.round(received / ingestRollupS))} readings per second (readings received / elapsed)`);
console.log(`ingest alone:                     ${fmt(Math.round(received / secs(ingestNs)))} readings per second`);
console.log(`memory after the run:             heap used ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MiB, rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
console.log("");

check("at least 1,000,000 readings went through ingest and rollup", received >= 1_000_000, `received ${received}`);
check("every stored reading is one the generator meant to keep", accepted === expectedAccepted && store.count() === expectedAccepted, `accepted ${accepted} expected ${expectedAccepted} stored ${store.count()}`);
check("every reading is accounted for: received = stored + duplicates + quarantined", received === accepted + duplicates + Object.values(reasons).reduce((x, y) => x + y, 0));
check("the planted defects were found, per asset: 1 duplicate, 1 late merge, 5 quarantined (too_late, conflicting_duplicate, out_of_range, 2 invalid_timestamp)", duplicates === ASSETS && lateMerged === ASSETS && reasons.too_late === ASSETS && reasons.conflicting_duplicate === ASSETS && reasons.out_of_range === ASSETS && reasons.invalid_timestamp === 2 * ASSETS, JSON.stringify({ duplicates, lateMerged, reasons }));

let rows5 = 0;
let rows1 = 0;
let count5 = 0;
let count1 = 0;
let energy5 = 0;
let energy1 = 0;
let independent = 0;
let worstAsset = 0;
for (const assetId of index.assets()) {
  const r5 = index.rowsFor(assetId, "5m");
  const r1 = index.rowsFor(assetId, "1h");
  rows5 += r5.length;
  rows1 += r1.length;
  const e5 = r5.reduce((s, r) => s + (r.energy_kwh as number), 0);
  const e1 = r1.reduce((s, r) => s + (r.energy_kwh as number), 0);
  count5 += r5.reduce((s, r) => s + (r.readings as number), 0);
  count1 += r1.reduce((s, r) => s + (r.readings as number), 0);
  energy5 += e5;
  energy1 += e1;
  const want = independentEnergy.get(assetId) as number;
  independent += want;
  worstAsset = Math.max(worstAsset, Math.abs(e1 - want), Math.abs(e5 - want));
}
console.log(`rollup rows: ${fmt(rows5)} five minute rows, ${fmt(rows1)} hourly rows; energy ${energy1.toFixed(3)} kWh from hourly rows, ${energy5.toFixed(3)} kWh from five minute rows, ${independent.toFixed(3)} kWh from an independent trapezoid sum`);
check("the five minute rows and the hourly rows both count every stored reading", count5 === accepted && count1 === accepted, `${count5} ${count1} ${accepted}`);
check("each asset's energy from the hourly rows and from the five minute rows matches the independent sum (largest difference under 1e-6 kWh)", worstAsset < 1e-6, `worst difference ${worstAsset}`);
check("the rollups hold one row per bucket that has readings, counted from the clean readings: a bucket wholly inside the planted gap has no row", rows5 === expectedRows5 && rows1 === expectedRows1 && rows5 < ASSETS * 288, `${rows5} vs ${expectedRows5}, ${rows1} vs ${expectedRows1}`);

// Lake: write everything, then read it back.
const dir = mkdtempSync(join(tmpdir(), "telemetry-load-"));
try {
  const lake = new FsLakeStore(dir);
  const t0 = process.hrtime.bigint();
  let files = 0;
  for (const [assetId, s] of store.series) {
    files += (await writeReadings(lake, s.rows, `load-${assetId}`)).length;
    for (const res of RESOLUTIONS) {
      await writeRollupDay(lake, res.name, assetId, DAY, index.rowsForDay(assetId, res.name, DAY));
      files++;
    }
  }
  if ((await writeQuarantine(lake, DAY, [...store.quarantine.values()], "load")) !== null) files++;
  const writeS = secs(process.hrtime.bigint() - t0);
  console.log(`lake write: ${fmt(files)} files in ${writeS.toFixed(2)} s (${fmt(Math.round(accepted / writeS))} readings per second to a local folder)`);
  const t1 = process.hrtime.bigint();
  const back = await readReadings(lake);
  const quarantined = await readQuarantine(lake);
  const readS = secs(process.hrtime.bigint() - t1);
  console.log(`lake read back: ${fmt(back.length)} readings and ${fmt(quarantined.length)} quarantine entries in ${readS.toFixed(2)} s`);
  check("the lake holds exactly the stored readings, read back", back.length === accepted, `${back.length} vs ${accepted}`);
  check("the quarantine file holds one entry per distinct rejected input", quarantined.length === store.quarantine.size && quarantined.length === 5 * ASSETS, `${quarantined.length} vs ${store.quarantine.size}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nAll load run checks passed" : `\n${failed} load run check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
