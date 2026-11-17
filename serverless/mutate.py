"""Mutation check for the order pipeline slice. LIFESPAN: permanent.

Each mutant breaks one rule in a scratch copy of this folder and the tests that own that rule must go red. The real
files are never touched. A mutant that stays green means a test is missing or too weak, and the run exits 1.

Run: python mutate.py [piece ...]      pieces: sqs dynamodb stream saga events bedrock strangler (default: all)
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASL = "orders/saga/order_saga.asl.json"

# (piece, name, file, old, new, test files that must fail)
MUTANTS: list[tuple[str, str, str, str, str, list[str]]] = [
    ("sqs", "the redrive threshold is 100 instead of the configured count", "orders/messaging.py", '"maxReceiveCount": str(max_receive_count)', '"maxReceiveCount": "100"', ["tests/test_messaging.py"]),
    ("sqs", "the dead-letter queue keeps messages for a minute only", "orders/messaging.py", "str(14 * 24 * 3600)", "str(60)", ["tests/test_messaging.py"]),
    ("sqs", "failed messages are deleted along with the good ones", "orders/messaging.py", 'done = [m for m in messages if m["MessageId"] not in failed_ids]', "done = list(messages)", ["tests/test_messaging.py"]),
    ("sqs", "a crashed handler deletes the batch", "orders/messaging.py", 'return {"received": len(messages), "deleted": 0, "failed": len(messages)}', 'return {"received": len(messages), "deleted": len(messages), "failed": 0}', ["tests/test_messaging.py"]),
    ("sqs", "redrive keeps the message in the dead-letter queue after sending it", "orders/messaging.py", "sqs.delete_message(QueueUrl=queues.dlq_url, ReceiptHandle=message[\"ReceiptHandle\"])", "pass", ["tests/test_messaging.py"]),
    ("sqs", "redrive deletes without sending", "orders/messaging.py", 'sqs.send_message(QueueUrl=queues.url, MessageBody=message["Body"], MessageAttributes=message.get("MessageAttributes", {}))', "pass", ["tests/test_messaging.py"]),
    ("sqs", "the handler never reports a failed message", "orders/handler.py", 'failures.append({"itemIdentifier": record["messageId"]})', "pass", ["tests/test_handler.py"]),
    ("sqs", "a cancelled order is treated as a failure and retried", "orders/handler.py", 'elif execution.error == "OrderCancelled":', "elif False:", ["tests/test_handler.py"]),
    ("sqs", "a malformed body is accepted with no lines", "orders/store.py", 'if not isinstance(raw_lines, list) or not raw_lines:', "if not isinstance(raw_lines, list):", ["tests/test_store.py", "tests/test_handler.py"]),

    ("dynamodb", "create no longer refuses an existing order id", "orders/store.py", '"GSI1SK": f"{order.created_at}#{order.order_id}",\n                },\n                "ConditionExpression": "attribute_not_exists(PK)",', '"GSI1SK": f"{order.created_at}#{order.order_id}",\n                },', ["tests/test_store.py"]),
    ("dynamodb", "optimistic lock: the version is not part of the condition", "orders/store.py", "attribute_exists(PK) AND #v = :ev AND #s IN", "attribute_exists(PK) AND #s IN", ["tests/test_store.py"]),
    ("dynamodb", "a transition no longer checks the status it comes from", "orders/store.py", "attribute_exists(PK) AND #v = :ev AND #s IN ({', '.join(status_in)})", "attribute_exists(PK) AND #v = :ev", ["tests/test_store.py"]),
    ("dynamodb", "the version is not bumped by a transition", "orders/store.py", 'UpdateExpression="SET #s = :to, #v = :nv"', 'UpdateExpression="SET #s = :to"', ["tests/test_store.py"]),
    ("dynamodb", "stock can go below zero", "orders/store.py", '"ConditionExpression": "available >= :q",', '"ConditionExpression": "attribute_exists(PK)",', ["tests/test_store.py"]),
    ("dynamodb", "a reservation can be written twice for one order", "orders/store.py", '"qty": line.qty},\n                    "ConditionExpression": "attribute_not_exists(PK)",', '"qty": line.qty},', ["tests/test_store.py"]),
    ("dynamodb", "a release deletes the reservation without a condition", "orders/store.py", '"Key": key, "ConditionExpression": "attribute_exists(PK)"}},', '"Key": key}},', ["tests/test_store.py"]),
    ("dynamodb", "a cancelled order may be reserved again", "orders/store.py", "RESERVED: (PENDING,),", "RESERVED: (PENDING, CANCELLED),", ["tests/test_store.py"]),
    ("dynamodb", "an earlier step is not a no-op once the order is further along", "orders/store.py", " or (to_status in FORWARD and current.status in FORWARD and FORWARD.index(current.status) >= FORWARD.index(to_status))", "", ["tests/test_store.py"]),

    ("stream", "the read model applies a record whatever its version", "orders/readmodel.py", 'ConditionExpression="attribute_not_exists(order_id) OR #v < :v",', 'ConditionExpression="attribute_exists(customer_id) OR attribute_not_exists(customer_id)",', ["tests/test_readmodel.py"]),
    ("stream", "a repeated record is applied again", "orders/readmodel.py", "OR #v < :v", "OR #v <= :v", ["tests/test_readmodel.py"]),
    ("stream", "lines, stock and payments are projected too", "orders/readmodel.py", 'if not _is_meta(new):\n        return "ignored"', "if False:\n        return \"ignored\"", ["tests/test_readmodel.py"]),
    ("stream", "a removed order stays in the read model", "orders/readmodel.py", 'if record["eventName"] == "REMOVE":', "if False:", ["tests/test_readmodel.py"]),
    ("stream", "the handler keeps applying records after a failed one", "orders/readmodel.py", '"SequenceNumber"]})\n                break', '"SequenceNumber"]})', ["tests/test_readmodel.py"]),
    ("stream", "the poller forgets where it stopped", "orders/readmodel.py", "self.checkpoint[shard_id] = seq", "pass", ["tests/test_readmodel.py"]),

    ("saga", "a failed payment skips the refund compensation", ASL, '"Next": "RefundPayment" }\n      ],\n      "Next": "CreateShipment"', '"Next": "CancelOrder" }\n      ],\n      "Next": "CreateShipment"', ["tests/test_asl.py", "tests/test_saga.py"]),
    ("saga", "a failed reservation skips its own release", ASL, '"Next": "ReleaseInventory" }\n      ],\n      "Next": "NeedsPayment"', '"Next": "CancelOrder" }\n      ],\n      "Next": "NeedsPayment"', ["tests/test_asl.py"]),
    ("saga", "a failed shipment skips the carrier cancellation", ASL, '"Next": "CancelShipment" }\n      ],\n      "Next": "ConfirmOrder"', '"Next": "RefundPayment" }\n      ],\n      "Next": "ConfirmOrder"', ["tests/test_asl.py"]),
    ("saga", "a free order is charged", ASL, '"NumericGreaterThan": 0', '"NumericGreaterThan": -1', ["tests/test_asl.py", "tests/test_saga.py"]),
    ("saga", "retries do not back off", "orders/saga/asl.py", '(rule.get("BackoffRate", 2.0) ** used)', "(rule.get(\"BackoffRate\", 2.0) ** 0)", ["tests/test_asl.py", "tests/test_saga.py"]),
    ("saga", "one retry more than MaxAttempts", "orders/saga/asl.py", 'if used >= rule.get("MaxAttempts", 3):', 'if used > rule.get("MaxAttempts", 3):', ["tests/test_asl.py", "tests/test_saga.py"]),
    ("saga", "States.ALL no longer matches an error", "orders/saga/asl.py", 'if "States.ALL" in names or "States.TaskFailed" in names or error in names:', "if error in names:", ["tests/test_asl.py", "tests/test_saga.py"]),
    ("saga", "the refund relies on what the state remembers", "orders/saga/steps.py", 'payments.refund(f"order-{state[\'order_id\']}")', 'payments.refund(state["payment"]["payment_id"])', ["tests/test_saga.py"]),
    ("saga", "the release compensation gives nothing back", "orders/saga/steps.py", '{"released": store.release_stock(ddb, order_of(state), table)}', '{"released": 0}', ["tests/test_saga.py"]),
    ("saga", "a missing function is swallowed as a task failure", "orders/saga/asl.py", "            except DefinitionError:\n                raise  # a missing function is a wiring mistake, not a task failure a Catch may swallow\n", "", ["tests/test_asl.py"]),

    ("events", "the event type is not the detail-type", "orders/events.py", '"DetailType": event_type', '"DetailType": "OrderEvent"', ["tests/test_handler.py"]),
    ("events", "a rejected EventBridge entry is ignored", "orders/events.py", 'if resp.get("FailedEntryCount", 0):', "if False:", ["tests/test_handler.py"]),

    ("bedrock", "access denied is retried like a throttle", "orders/bedrock.py", 'if code == "AccessDeniedException":\n                    raise ModelAccessError(f"access denied', 'if False:\n                    raise ModelAccessError(f"access denied', ["tests/test_bedrock.py"]),
    ("bedrock", "throttling is not retried", "orders/bedrock.py", 'RETRYABLE = {"ThrottlingException", ', "RETRYABLE = {", ["tests/test_bedrock.py"]),
    ("bedrock", "the retry wait does not grow", "orders/bedrock.py", "self.base_delay * (2 ** (attempt - 1)) * self.jitter()", "self.base_delay * self.jitter()", ["tests/test_bedrock.py"]),
    ("bedrock", "retries never give up", "orders/bedrock.py", "if attempt == self.max_attempts:", "if attempt > self.max_attempts:", ["tests/test_bedrock.py"]),
    ("bedrock", "the account authorization is not checked", "orders/bedrock.py", 'if availability["authorizationStatus"] != "AUTHORIZED" or availability["entitlementAvailability"] != "AVAILABLE":', 'if availability["entitlementAvailability"] != "AVAILABLE":', ["tests/test_bedrock.py"]),
    ("bedrock", "an empty reply is returned as an answer", "orders/bedrock.py", "if not text:\n            raise ModelFailed", "if False:\n            raise ModelFailed", ["tests/test_bedrock.py"]),
    ("bedrock", "triage sends the whole body", "orders/triage.py", 'body = message["Body"][:MAX_BODY_CHARS]', 'body = message["Body"]', ["tests/test_bedrock.py"]),

    ("strangler", "a caller at the cut-off percentage is moved early", "orders/strangler.py", "bucket(key) < rule.percent", "bucket(key) <= rule.percent", ["tests/test_strangler.py"]),
    ("strangler", "the bucket is random instead of stable", "orders/strangler.py", 'int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16) % 100', '__import__("random").randrange(100)', ["tests/test_strangler.py"]),
    ("strangler", "an unlisted route goes to the new system", "orders/strangler.py", 'if rule is None or rule.mode == "legacy":\n            return "legacy"', 'if rule is None:\n            return "modern"\n        if rule.mode == "legacy":\n            return "legacy"', ["tests/test_strangler.py"]),
    ("strangler", "a 5xx from the new system is passed on", "orders/strangler.py", 'result["statusCode"] >= 500', 'result["statusCode"] >= 600', ["tests/test_strangler.py"]),
    ("strangler", "the allow list is ignored", "orders/strangler.py", 'return "modern" if key in rule.allow else "legacy"', 'return "modern"', ["tests/test_strangler.py"]),
    ("strangler", "the new handler lists only one order", "orders/routes.py", "lambda cid: readmodel.orders_for_customer(ddb, cid, table),", "lambda cid: readmodel.orders_for_customer(ddb, cid, table)[:1],", ["tests/test_strangler.py"]),
    ("strangler", "the new handler forgets who owns an order", "orders/routes.py", "lambda cid, oid: readmodel.get_view(ddb, cid, oid, table),", 'lambda cid, oid: readmodel.get_view(ddb, "c1", oid, table),', ["tests/test_strangler.py"]),
]


def pytest_exit_code(root: Path, tests: list[str]) -> int:
    result = subprocess.run([sys.executable, "-m", "pytest", "-x", "-q", "-p", "no:cacheprovider", *tests], cwd=root, capture_output=True, text=True)
    return result.returncode


def main(argv: list[str]) -> int:
    wanted = set(argv) or {m[0] for m in MUTANTS}
    chosen = [m for m in MUTANTS if m[0] in wanted]
    caught, survived, broken = 0, [], []
    with tempfile.TemporaryDirectory() as tmp:
        for piece, name, file, old, new, tests in chosen:
            work = Path(tmp) / "copy"
            if work.exists():
                shutil.rmtree(work)
            shutil.copytree(HERE, work, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "mutate.py"))
            target = work / file
            text = target.read_text(encoding="utf-8")
            if text.count(old) != 1:
                broken.append(f"{piece}: {name}: the text to change appears {text.count(old)} times in {file}")
                continue
            target.write_text(text.replace(old, new), encoding="utf-8")
            code = pytest_exit_code(work, tests)
            if code == 1:
                caught += 1
                print(f"caught    {piece:9} {name}")
            else:
                survived.append(f"{piece}: {name} (pytest exit {code})")
                print(f"SURVIVED  {piece:9} {name} (pytest exit {code})")
    print(f"\n{caught} of {len(chosen)} deliberate breaks caught")
    for line in broken + survived:
        print("PROBLEM:", line)
    return 0 if not (broken or survived) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
