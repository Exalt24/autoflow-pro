import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { assertTopology, topologyFor, type Topology } from "./topology.js";
import type { IdempotencyStore } from "./idempotency.js";
import {
  ATTEMPT_HEADER,
  DEAD_ERROR_HEADER,
  DEAD_REASON_HEADER,
  decideOnFailure,
  describeError,
  parseEnvelope,
  readAttempt,
  type RetryPolicy,
} from "./retryPolicy.js";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (msg, fields) => console.log(JSON.stringify({ level: "info", msg, ...fields })),
  warn: (msg, fields) => console.warn(JSON.stringify({ level: "warn", msg, ...fields })),
  error: (msg, fields) => console.error(JSON.stringify({ level: "error", msg, ...fields })),
};

export interface HandlerContext {
  messageId: string;
  /** 1 on the first delivery, 2 on the first retry, and so on. */
  attempt: number;
}

export type Handler = (payload: unknown, ctx: HandlerContext) => Promise<void>;

/** The one thing the consumer needs from a connection; an amqplib connection satisfies this. */
export interface ChannelSource {
  createConfirmChannel(): Promise<ConfirmChannel>;
}

export interface ConsumerOptions {
  queue: string;
  policy: RetryPolicy;
  store: IdempotencyStore;
  handler: Handler;
  prefetch?: number;
  /** How long a claim holds while a handler runs. A crashed consumer's claim frees itself after this. */
  lockTtlMs?: number;
  /** How long "already handled" is remembered. Should outlast the longest redelivery you expect. */
  doneTtlMs?: number;
  /** stop() waits this long for running handlers before it closes the channel anyway. */
  shutdownTimeoutMs?: number;
  logger?: Logger;
}

/**
 * Durable queue, manual ack, retry through delay queues and a dead-letter exchange, idempotent handling,
 * graceful stop. The message is acked only after the handler finished, or after its retry / dead-letter
 * copy was confirmed by the broker, so a crash can duplicate a message but never lose one.
 */
export class ReliableConsumer {
  readonly topology: Topology;
  private channel: ConfirmChannel | null = null;
  private consumerTag: string | null = null;
  private inFlight = new Set<Promise<void>>();
  private stopping = false;
  private stopPromise: Promise<void> | null = null;
  private readonly log: Logger;

  constructor(private source: ChannelSource, private opts: ConsumerOptions) {
    this.topology = topologyFor(opts.queue);
    this.log = opts.logger ?? consoleLogger;
  }

  get running(): boolean {
    return this.channel !== null && this.consumerTag !== null && !this.stopping;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  async start(): Promise<void> {
    const channel = await this.source.createConfirmChannel();
    this.channel = channel;
    channel.on("error", (err: Error) => this.log.error("channel error", { error: err.message }));
    channel.on("close", () => {
      if (!this.stopping) this.log.warn("channel closed unexpectedly");
      this.consumerTag = null;
    });
    await assertTopology(channel, this.topology, this.opts.policy);
    await channel.prefetch(this.opts.prefetch ?? 5);
    const { consumerTag } = await channel.consume(
      this.opts.queue,
      (msg) => {
        if (msg === null) {
          // The broker cancelled this consumer (queue deleted, node failover). Nothing more will arrive.
          this.log.error("consumer cancelled by the broker");
          this.consumerTag = null;
          return;
        }
        const work: Promise<void> = this.handle(msg).finally(() => this.inFlight.delete(work));
        this.inFlight.add(work);
      },
      { noAck: false },
    );
    this.consumerTag = consumerTag;
    this.log.info("consuming", { queue: this.opts.queue, prefetch: this.opts.prefetch ?? 5 });
  }

  /** Stop taking new messages, let running handlers finish and ack, then close the channel. Safe to call twice. */
  stop(): Promise<void> {
    this.stopPromise ??= this.doStop();
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    this.stopping = true;
    const channel = this.channel;
    if (!channel) return;
    try {
      if (this.consumerTag) await channel.cancel(this.consumerTag);
    } catch (err) {
      this.log.warn("cancel failed", { error: describeError(err) });
    }
    const waitMs = this.opts.shutdownTimeoutMs ?? 25000;
    let timer: NodeJS.Timeout | undefined;
    const waitOver = new Promise<"gave-up">((resolve) => {
      timer = setTimeout(() => resolve("gave-up"), waitMs);
    });
    const outcome = await Promise.race([Promise.allSettled([...this.inFlight]).then(() => "drained" as const), waitOver]);
    clearTimeout(timer);
    if (outcome === "gave-up") {
      this.log.warn("closing with handlers still running", { inFlight: this.inFlight.size, waitedMs: waitMs });
    }
    try {
      await channel.close();
    } catch (err) {
      this.log.warn("channel close failed", { error: describeError(err) });
    }
    this.channel = null;
    this.consumerTag = null;
    this.log.info("consumer stopped", { drained: outcome === "drained" });
  }

  private async handle(msg: ConsumeMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    try {
      await this.process(channel, msg);
    } catch (err) {
      // Infrastructure trouble (a publish was not confirmed, the channel is going away). The message is
      // still unacked here, so give it back to the broker rather than lose it.
      this.log.error("could not settle message, returning it to the queue", { error: describeError(err) });
      try {
        channel.nack(msg, false, true);
      } catch {
        // The channel is already closed; the broker redelivers unacked messages by itself.
      }
    }
  }

  private async process(channel: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    if (this.stopping) {
      channel.nack(msg, false, true);
      return;
    }

    const attempt = readAttempt(msg.properties.headers);
    const messageId = msg.properties.messageId as string | undefined;

    if (!messageId) {
      await this.deadLetter(channel, msg, "missing-message-id");
      return;
    }
    const envelope = parseEnvelope(msg.content);
    if (!envelope.ok) {
      await this.deadLetter(channel, msg, envelope.reason);
      return;
    }

    const key = `${this.opts.queue}:${messageId}`;
    const claim = await this.opts.store.claim(key, this.opts.lockTtlMs ?? 5 * 60_000);
    if (claim === "done") {
      this.log.info("duplicate delivery skipped", { messageId });
      channel.ack(msg);
      return;
    }
    if (claim === "busy") {
      // Another consumer holds the claim. Come back later; this is not a failure, so the attempt does not count.
      const delayMs = this.opts.policy.delaysMs[0] ?? 1000;
      await this.republish(channel, msg, delayMs, attempt);
      channel.ack(msg);
      this.log.info("message busy elsewhere, parked for a retry", { messageId, delayMs });
      return;
    }

    try {
      await this.opts.handler(envelope.payload, { messageId, attempt });
    } catch (error) {
      await this.opts.store.release(key);
      const decision = decideOnFailure(attempt, error, this.opts.policy);
      if (decision.action === "retry") {
        await this.republish(channel, msg, decision.delayMs, decision.nextAttempt);
        channel.ack(msg);
        this.log.warn("handler failed, retry scheduled", {
          messageId,
          attempt,
          delayMs: decision.delayMs,
          error: describeError(error),
        });
      } else {
        await this.deadLetter(channel, msg, decision.reason, describeError(error));
      }
      return;
    }

    await this.opts.store.complete(key, this.opts.doneTtlMs ?? 24 * 60 * 60_000);
    channel.ack(msg);
  }

  private async republish(channel: ConfirmChannel, msg: ConsumeMessage, delayMs: number, nextAttempt: number): Promise<void> {
    await this.publishConfirmed(channel, this.topology.retryExchange, String(delayMs), msg, {
      ...msg.properties.headers,
      [ATTEMPT_HEADER]: nextAttempt,
    });
  }

  private async deadLetter(channel: ConfirmChannel, msg: ConsumeMessage, reason: string, error?: string): Promise<void> {
    await this.publishConfirmed(channel, this.topology.deadExchange, this.topology.routingKey, msg, {
      ...msg.properties.headers,
      [DEAD_REASON_HEADER]: reason,
      ...(error ? { [DEAD_ERROR_HEADER]: error } : {}),
    });
    channel.ack(msg);
    this.log.error("message dead-lettered", { messageId: msg.properties.messageId, reason, error });
  }

  private publishConfirmed(
    channel: ConfirmChannel,
    exchange: string,
    routingKey: string,
    msg: ConsumeMessage,
    headers: Record<string, unknown>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      channel.publish(
        exchange,
        routingKey,
        msg.content,
        {
          persistent: true,
          messageId: msg.properties.messageId,
          contentType: msg.properties.contentType,
          timestamp: msg.properties.timestamp,
          headers,
        },
        (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve()),
      );
    });
  }
}
