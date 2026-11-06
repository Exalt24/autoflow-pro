import type { Channel } from "amqplib";
import { uniqueDelays, type RetryPolicy } from "./retryPolicy.js";

/**
 * One queue and everything around it, all named from the queue name:
 *
 *   publisher -> [work exchange] -> [queue] -> consumer
 *                                     |  (consumer fails, attempts left)
 *                                     v
 *                  [retry exchange] -> [queue.retry.<ms>ms]  (TTL = <ms>, dead-letters back to the work exchange)
 *                                     |  (attempts used up, or a permanent error)
 *                                     v
 *                  [dead exchange]  -> [queue.dead]  (parking lot, read it by hand)
 *
 * The main queue also dead-letters to the dead exchange, so a message rejected without requeue
 * (nack with requeue=false) lands in the parking lot even if the consumer never got to publish it.
 */
export interface Topology {
  queue: string;
  workExchange: string;
  retryExchange: string;
  deadExchange: string;
  deadQueue: string;
  routingKey: string;
}

export function topologyFor(queue: string): Topology {
  return {
    queue,
    workExchange: `${queue}.work`,
    retryExchange: `${queue}.retry`,
    deadExchange: `${queue}.dead`,
    deadQueue: `${queue}.dead`,
    routingKey: queue,
  };
}

export function delayQueueName(t: Topology, delayMs: number): string {
  return `${t.queue}.retry.${delayMs}ms`;
}

export async function assertTopology(channel: Channel, t: Topology, policy: RetryPolicy): Promise<void> {
  await channel.assertExchange(t.workExchange, "direct", { durable: true });
  await channel.assertExchange(t.retryExchange, "direct", { durable: true });
  await channel.assertExchange(t.deadExchange, "direct", { durable: true });

  await channel.assertQueue(t.deadQueue, { durable: true });
  await channel.bindQueue(t.deadQueue, t.deadExchange, t.routingKey);

  await channel.assertQueue(t.queue, {
    durable: true,
    arguments: { "x-dead-letter-exchange": t.deadExchange, "x-dead-letter-routing-key": t.routingKey },
  });
  await channel.bindQueue(t.queue, t.workExchange, t.routingKey);

  for (const ms of uniqueDelays(policy)) {
    const name = delayQueueName(t, ms);
    await channel.assertQueue(name, {
      durable: true,
      arguments: {
        "x-message-ttl": ms,
        "x-dead-letter-exchange": t.workExchange,
        "x-dead-letter-routing-key": t.routingKey,
      },
    });
    await channel.bindQueue(name, t.retryExchange, String(ms));
  }
}
