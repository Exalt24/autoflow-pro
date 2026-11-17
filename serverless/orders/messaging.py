"""SQS side: a work queue with a dead-letter queue, and a stand-in for the Lambda event source mapping.

A real queue redelivers a message whose visibility timeout runs out and moves it to the dead-letter queue once it
has been received `maxReceiveCount` times (the redrive policy). The Lambda event source mapping hands a batch of
messages to the function and deletes only the ones the function did not list in `batchItemFailures`
(ReportBatchItemFailures). `poll_and_invoke` does the second part by hand so a handler can be tested without Lambda.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class Queues:
    url: str
    arn: str
    dlq_url: str
    dlq_arn: str


def _arn(sqs: Any, url: str) -> str:
    return sqs.get_queue_attributes(QueueUrl=url, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]


def create_order_queues(sqs: Any, name: str, max_receive_count: int = 3, visibility_timeout: int = 30) -> Queues:
    """Create `<name>-dlq` first, then `<name>` with a redrive policy that points at it."""
    if max_receive_count < 1:
        raise ValueError("max_receive_count must be at least 1")
    dlq_url = sqs.create_queue(
        QueueName=f"{name}-dlq",
        Attributes={"MessageRetentionPeriod": str(14 * 24 * 3600)},  # keep poison messages longer than the source keeps them
    )["QueueUrl"]
    dlq_arn = _arn(sqs, dlq_url)
    url = sqs.create_queue(
        QueueName=name,
        Attributes={
            "VisibilityTimeout": str(visibility_timeout),
            "RedrivePolicy": json.dumps({"deadLetterTargetArn": dlq_arn, "maxReceiveCount": str(max_receive_count)}),
        },
    )["QueueUrl"]
    return Queues(url, _arn(sqs, url), dlq_url, dlq_arn)


def _to_record(message: dict[str, Any], queue_arn: str) -> dict[str, Any]:
    """The shape Lambda passes for an SQS message (documented in the Lambda developer guide)."""
    return {
        "messageId": message["MessageId"],
        "receiptHandle": message["ReceiptHandle"],
        "body": message["Body"],
        "attributes": {
            "ApproximateReceiveCount": message["Attributes"]["ApproximateReceiveCount"],
            "SentTimestamp": message["Attributes"].get("SentTimestamp", ""),
        },
        "messageAttributes": message.get("MessageAttributes", {}),
        "md5OfBody": message["MD5OfBody"],
        "eventSource": "aws:sqs",
        "eventSourceARN": queue_arn,
    }


def poll_and_invoke(sqs: Any, queues: Queues, handler: Callable[[dict[str, Any], Any], dict[str, Any] | None], batch_size: int = 10) -> dict[str, int]:
    """Receive up to `batch_size` messages, call the handler once with the batch and delete the successes.

    A handler that raises fails the whole batch (nothing is deleted); a handler that returns `batchItemFailures`
    fails only the listed message ids. Returns counts so a test can see what happened.
    """
    resp = sqs.receive_message(
        QueueUrl=queues.url,
        MaxNumberOfMessages=batch_size,
        AttributeNames=["All"],
        MessageAttributeNames=["All"],
        WaitTimeSeconds=0,
    )
    messages = resp.get("Messages", [])
    if not messages:
        return {"received": 0, "deleted": 0, "failed": 0}
    event = {"Records": [_to_record(m, queues.arn) for m in messages]}
    try:
        result = handler(event, None) or {}
    except Exception:  # noqa: BLE001  a crashed invocation fails the whole batch, like Lambda
        return {"received": len(messages), "deleted": 0, "failed": len(messages)}
    failed_ids = {f["itemIdentifier"] for f in result.get("batchItemFailures", [])}
    done = [m for m in messages if m["MessageId"] not in failed_ids]
    if done:
        sqs.delete_message_batch(
            QueueUrl=queues.url,
            Entries=[{"Id": str(n), "ReceiptHandle": m["ReceiptHandle"]} for n, m in enumerate(done)],
        )
    return {"received": len(messages), "deleted": len(done), "failed": len(messages) - len(done)}


def drain(sqs: Any, queues: Queues, handler: Callable[[dict[str, Any], Any], dict[str, Any] | None], max_polls: int = 20) -> dict[str, int]:
    """Poll until a poll returns nothing (or `max_polls`). Messages that keep failing come back until they are dead-lettered."""
    total = {"received": 0, "deleted": 0, "failed": 0}
    for _ in range(max_polls):
        step = poll_and_invoke(sqs, queues, handler)
        if step["received"] == 0:
            break
        for key in total:
            total[key] += step[key]
    return total


def dlq_depth(sqs: Any, queues: Queues) -> int:
    """Messages in the DLQ, counting the ones another reader currently holds."""
    names = ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
    attrs = sqs.get_queue_attributes(QueueUrl=queues.dlq_url, AttributeNames=names)["Attributes"]
    return sum(int(attrs[name]) for name in names)


def read_dlq(sqs: Any, queues: Queues, limit: int = 10) -> list[dict[str, Any]]:
    """Peek at dead-lettered messages without removing them (visibility timeout 0, so they stay in the queue)."""
    resp = sqs.receive_message(QueueUrl=queues.dlq_url, MaxNumberOfMessages=limit, VisibilityTimeout=0, AttributeNames=["All"])
    return resp.get("Messages", [])


def redrive_dlq(sqs: Any, queues: Queues, limit: int = 10) -> int:
    """Send dead-lettered messages back to the work queue once the cause is fixed. Delete from the DLQ only after the send."""
    moved = 0
    resp = sqs.receive_message(QueueUrl=queues.dlq_url, MaxNumberOfMessages=limit, MessageAttributeNames=["All"])
    for message in resp.get("Messages", []):
        sqs.send_message(QueueUrl=queues.url, MessageBody=message["Body"], MessageAttributes=message.get("MessageAttributes", {}))
        sqs.delete_message(QueueUrl=queues.dlq_url, ReceiptHandle=message["ReceiptHandle"])
        moved += 1
    return moved
