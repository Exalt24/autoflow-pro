# RabbitMQ consumer and publisher

AutoFlow Pro already runs workflows through a BullMQ queue on Redis. This adds a second way in: a producer that speaks AMQP puts a run request on a RabbitMQ queue, a small worker reads it and adds the job to the same BullMQ queue. The code is in `backend/src/messaging/`.

## What it does

- **Durable queue, persistent messages.** Queues and exchanges are durable and the publisher sends messages with delivery mode 2. A broker restart keeps them.
- **Publisher confirms.** `ReliablePublisher.publish()` resolves only after the broker confirmed the message. A message that no queue is bound to is returned by the broker (`mandatory`) and `publish()` throws instead of dropping it.
- **Manual ack.** The consumer acks only after the handler finished, or after the retry or dead-letter copy was confirmed by the broker. A crash can deliver a message twice, never zero times.
- **Retry through a delay queue.** A failed message is published to a retry exchange. It lands in a queue named `<queue>.retry.<ms>ms` that has a TTL of that many milliseconds and dead-letters back to the work exchange, so it returns to the work queue after the delay. One delay queue per delay, so a long delay never blocks a short one. The attempt count rides in the `x-attempt` header. Default delays are 5 s, 30 s and 120 s (`RABBITMQ_RETRY_DELAYS_MS`), so a message gets 4 tries in total.
- **Dead-letter exchange.** When the tries run out, or the handler throws `PermanentError`, or the body is not JSON, or the message has no id, the message goes to `<queue>.dead` with `x-dead-reason` and `x-dead-error` headers. The work queue itself also dead-letters to that exchange, so a plain reject lands there too.
- **Idempotent handling.** Before the handler runs, the consumer claims `queue:messageId` in Redis (`SET NX PX`). A message that was already handled is acked and skipped. A message another consumer is working on right now is parked on the first delay queue without using up an attempt. A failed handler gives its claim back so the retry can run. A crashed consumer's claim frees itself after the lock TTL (5 minutes).
- **Graceful shutdown.** On SIGTERM the worker cancels its consumer so nothing new arrives, waits for running handlers (up to `SHUTDOWN_TIMEOUT_MS`), acks them, and closes. If the wait runs out, the unfinished messages go back to the queue. The pod's `terminationGracePeriodSeconds` in the Helm chart is set 10 s above that wait.
- **Probes.** The worker serves `/healthz` (alive) and `/readyz` (consumer running) on `HEALTH_PORT`.
- **Connection loss.** The worker exits when the broker connection closes unexpectedly, and Kubernetes starts a fresh pod that reconnects and re-declares everything. There is no in-process reconnect loop.

```
publisher -> [work exchange] -> [queue] -> consumer -> handler -> BullMQ "workflow-executions"
                                  ^           | fails, tries left
                                  |           v
                    (TTL expires) [retry exchange] -> [queue.retry.<ms>ms]
                                              | tries used up / permanent error / poison body
                                              v
                                        [dead exchange] -> [queue.dead]
```

## Run it

```bash
docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3-management
docker run -d --name redis -p 6379:6379 redis:7-alpine
cd backend && npm run build
RABBITMQ_URL=amqp://guest:guest@localhost:5672 REDIS_URL=redis://localhost:6379 npm run start:rabbitmq
```

Settings (all optional except the first two): `RABBITMQ_URL`, `REDIS_URL`, `RABBITMQ_QUEUE` (`autoflow.workflow.execute`), `RABBITMQ_PREFETCH` (5), `RABBITMQ_RETRY_DELAYS_MS` (`5000,30000,120000`), `HEALTH_PORT` (8081), `SHUTDOWN_TIMEOUT_MS` (25000). A bad value stops the worker at startup with a message that names the setting. The broker URL is never logged with its user and password.

A run request is `{ workflowId, executionId, userId, definition }`. The BullMQ job id is `rmq-<executionId>`, so BullMQ itself ignores a second add for the same run even if the Redis claim was lost.

## What was run

Everything below is in [docs/test-runs/2026-11-07-rabbitmq-consumer.txt](test-runs/2026-11-07-rabbitmq-consumer.txt).

- **A real broker was used.** RabbitMQ 3.13.7 (`rabbitmq:3-management`) and Redis 7 in Docker, started for the run and removed afterwards.
- `npm run test:rabbitmq-logic`: 41 of 41 checks passed, no broker needed. Retry and dead-letter decisions, header parsing, config parsing, the idempotency store and the run request check. Two of them run over seeded random worlds: 2000 retry runs checked against the attempt, delay and dead-letter rules, and 300 store runs checked against a reference model with an injected clock. Five deliberately broken versions (an off-by-one attempt index, retrying a permanent error, never dead-lettering, a store whose release forgets a finished message, a store that ignores expiry) each turn the property red.
- `npm run test:rabbitmq`: 38 of 38 checks passed against the real broker. They cover durable and persistent (read back through the management API), a handler that fails twice and succeeds on try 3 with the delays measured, a handler that always fails ending in the dead-letter queue with the reason and attempt count, a permanent error after one call, invalid JSON and a missing message id, duplicates across two competing consumers, redelivery of an unacked message after its channel dies, `stop()` waiting for a running handler, `stop()` giving up after its timeout, an unroutable publish, and the Redis store including 20 simultaneous claims with exactly one winner.
- Four mutations of `consumer.ts` (never ack, no duplicate check, retry straight back to the work exchange, `stop()` that does not wait) were each caught by the broker tests.
- The built image was also run as a pod in a local kind cluster, fed through RabbitMQ, and it created the BullMQ job, skipped the duplicate and dead-lettered the bad request. That run is in [docs/test-runs/2026-11-07-kind-cluster.txt](test-runs/2026-11-07-kind-cluster.txt).

CI runs the same two scripts in the `rabbitmq` job with RabbitMQ and Redis as service containers, and `REQUIRE_RABBITMQ=1` turns a missing broker into a failure instead of a skip.

## Not covered

- The handler only hands the run to BullMQ. It does not wait for the run to finish.
- A single broker node. Quorum queues and clustering were not tried.
- Reconnect without a restart. The worker relies on Kubernetes to restart it.
