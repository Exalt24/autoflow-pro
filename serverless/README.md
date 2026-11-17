# Order pipeline on AWS serverless building blocks

A small order pipeline in Python: an SQS queue with a dead-letter queue feeds Lambda-shaped handlers, a DynamoDB table holds the orders, a Step Functions saga runs the payment and shipping with compensations, a stream consumer builds a CQRS read model, a Bedrock client summarizes dead letters, and a strangler fig router moves two read routes from a legacy handler to the new one.

It was written from the public AWS documentation and tested against moto 5.2.5 (an AWS emulator that runs inside the test process) and stand-ins for the payment provider, the carrier and Bedrock. It has no AWS account behind it and costs nothing to run. The handlers are plain `handler(event, context)` functions with the documented SQS, DynamoDB stream and API Gateway event shapes, and a small stand-in for the event source mapping calls them; none of it is deployed to Lambda.

## Run it

```bash
cd serverless
pip install -r requirements.txt
python -m pytest          # about 460 tests, 300 of them seeded worlds for the saga
python mutate.py          # every deliberate break must turn a test red
```

The captured run is in [docs/test-runs/2026-11-17-serverless-order-pipeline.txt](https://github.com/Exalt24/autoflow-pro/blob/main/docs/test-runs/2026-11-17-serverless-order-pipeline.txt). CI runs both commands in `.github/workflows/serverless.yml` on a push that touches this folder.

## What is in it

| Piece | Files | What it does |
| --- | --- | --- |
| SQS and dead-letter queue | `orders/messaging.py`, `orders/handler.py` | An SQS queue with a dead-letter queue and a redrive policy. The handler reports `batchItemFailures`, so one bad message in a batch of ten retries alone, and a message received three times lands in the dead-letter queue. A redrive function sends dead letters back once the cause is fixed. |
| DynamoDB | `orders/store.py` | A single table design with conditional writes. Create refuses an existing order id, a transition carries a version (optimistic locking) and a legal source status, stock never goes below zero, and a reservation and its release can each run twice with one effect. |
| Stream and CQRS | `orders/readmodel.py` | A stream consumer builds a separate read model table (orders by customer, orders by status). A record is applied only when its version is newer, so repeated and out of order records do nothing. The read side is behind until the stream is read, and a test shows that. |
| Step Functions saga | `orders/saga/` | An Amazon States Language definition: reserve stock, charge, ship, confirm, with Retry (backoff) and Catch to compensations that undo the finished steps and cancel the order. A validator and a small runner execute it locally, because moto accepts any JSON as a state machine definition and does not run one. |
| Events | `orders/events.py` | The outcome goes to an SNS topic and an EventBridge bus; a rule routes `OrderConfirmed` only. |
| Bedrock | `orders/bedrock.py`, `orders/triage.py` | A Bedrock Converse client with model access checks, retry with jittered backoff and errors mapped from the documented error shapes. Dead-letter triage asks it for a two sentence reading of a failed message. |
| Strangler fig | `orders/strangler.py`, `orders/routes.py` | A router for an API Gateway HTTP API event that sends each route to the legacy or the new handler by a route table: legacy, modern, canary percent or allow list, with fallback to legacy on a 5xx. |

## What the tests are made of

Each piece has example tests, and three have more. The saga has a seeded property test: 300 random worlds where each step succeeds, fails for good, fails a few times or does its work and then times out, and in every world the order ends confirmed or fully compensated (stock back, charge refunded, shipment cancelled). The strangler has a parity test that the new handler answers exactly like the legacy one for the same calls, and a cutover test that moves one route per stage and checks no other route changed. The read model has out of order and repeated record cases.

`mutate.py` breaks one rule at a time in a scratch copy and the tests that own the rule must fail. All 50 breaks are caught: 9 SQS, 9 DynamoDB, 6 stream, 10 saga, 2 events, 7 Bedrock and 7 strangler.

The Bedrock tests use botocore's Stubber, which checks every request and every reply against the real `bedrock-runtime` and `bedrock` service models, and a fake. They show the client builds valid Converse requests and handles the documented errors. They do not call Bedrock.

## What was hard

The saga's compensation rule was wrong at first and the property test found it. A step can fail after its work was committed (a response lost on the way back), so a Catch that only undoes the steps before the failed one leaves that step's own work behind: stock stayed reserved when the reservation call timed out, and a shipment stayed booked when the carrier call did. Each failed step now runs its own compensation as well, every compensation is safe to repeat, and the validator checks the rule on the definition itself (`compensation_gaps`) so a hand edit of the JSON cannot drop it.

Redelivery was the second thing. SQS delivers at least once, so the handler has to survive a crash after the order was created, after the payment was taken, or after the saga finished but before the message was deleted. The order is created with a condition, a duplicate message resumes the saga only if the order is not finished, and every step reads what it already did. Tests kill the worker in the middle of the saga and after it, and check one charge and one reservation.

Moto's DynamoDB Streams answered `404 Not yet implemented` for the stream calls. The SDK sends any call that carries a stream ARN to an account id endpoint by default, and moto only routes the regional one, so the test client turns `account_id_endpoint_mode` off.

## Limits

The queue behaves like SQS in moto, but visibility timeouts and batching windows are not timed against a real queue. The ASL runner supports Task, Choice, Pass, Succeed, Fail, Retry and Catch, and the validator refuses the fields it does not run (Parameters, Map, Parallel). The payment provider and the carrier are stand-ins that keep one property of a real provider: the same idempotency key charges or ships once.
