import { createHash } from "node:crypto";
import type { Handler } from "../messaging/consumer.js";
import { PermanentError } from "../messaging/retryPolicy.js";
import type { TelemetryPipeline } from "./pipeline.js";

// The telemetry worker's handler for the RabbitMQ consumer in ../messaging. The consumer acks a message only after the
// handler resolves, and the handler resolves only after the readings, the quarantined input and the rollup files are
// in the lake. So a crash before the ack redelivers the message, and the redelivery finds every reading already stored
// (a duplicate) and counts nothing twice; a crash can duplicate delivery but never lose a reading.
//
// Message body: { "readings": [ { "asset_id": "pv-001", "ts": "...", "power_kw": 3.2 }, ... ] }
// A bad reading inside it is quarantined, not an error. A body that is not that shape is a PermanentError (dead letter).

export const MAX_READINGS_PER_MESSAGE = 10_000;
export const DEFAULT_QUEUE = "autoflow.telemetry.readings";

/** The file name part for everything one message writes. The same message id always gives the same name. */
export function batchIdFor(messageId: string): string {
  return createHash("sha256").update(messageId).digest("hex").slice(0, 24);
}

export function parseTelemetryMessage(payload: unknown): unknown[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new PermanentError("payload is not an object");
  const readings = (payload as Record<string, unknown>).readings;
  if (!Array.isArray(readings)) throw new PermanentError("payload.readings must be an array");
  if (readings.length > MAX_READINGS_PER_MESSAGE) throw new PermanentError(`payload.readings holds more than ${MAX_READINGS_PER_MESSAGE} readings`);
  return readings;
}

export function createTelemetryHandler(pipeline: TelemetryPipeline): Handler {
  return async (payload, ctx) => {
    const readings = parseTelemetryMessage(payload);
    await pipeline.process(readings, batchIdFor(ctx.messageId));
  };
}
