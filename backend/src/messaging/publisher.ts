import { randomUUID } from "node:crypto";
import type { ConfirmChannel } from "amqplib";
import { assertTopology, topologyFor, type Topology } from "./topology.js";
import { ATTEMPT_HEADER, type RetryPolicy } from "./retryPolicy.js";
import type { ChannelSource } from "./consumer.js";

/**
 * Publishes persistent messages on a confirm channel and resolves only once the broker has taken
 * responsibility for the message. A message nothing is bound to (mandatory + return) is an error, not a silent drop.
 */
export class ReliablePublisher {
  readonly topology: Topology;
  private channel: ConfirmChannel | null = null;
  private returned = new Set<string>();

  constructor(private source: ChannelSource, queue: string, private policy: RetryPolicy) {
    this.topology = topologyFor(queue);
  }

  async start(): Promise<void> {
    const channel = await this.source.createConfirmChannel();
    channel.on("return", (msg) => {
      const id = msg.properties.messageId as string | undefined;
      if (id) this.returned.add(id);
    });
    channel.on("error", () => {
      // The next publish() rejects with the channel error; nothing to do here.
    });
    await assertTopology(channel, this.topology, this.policy);
    this.channel = channel;
  }

  /** Returns the message id. Pass your own `messageId` (for example the execution id) so redeliveries and duplicates are recognised. */
  async publish(payload: unknown, opts: { messageId?: string } = {}): Promise<string> {
    const channel = this.channel;
    if (!channel) throw new Error("publisher not started");
    const messageId = opts.messageId ?? randomUUID();
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        this.topology.workExchange,
        this.topology.routingKey,
        body,
        {
          persistent: true,
          mandatory: true,
          messageId,
          contentType: "application/json",
          timestamp: Math.floor(Date.now() / 1000),
          headers: { [ATTEMPT_HEADER]: 1 },
        },
        (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve()),
      );
    });
    if (this.returned.delete(messageId)) {
      throw new Error(`message ${messageId} was returned by the broker: no queue is bound to ${this.topology.workExchange}`);
    }
    return messageId;
  }

  async close(): Promise<void> {
    const channel = this.channel;
    this.channel = null;
    if (channel) await channel.close();
  }
}
