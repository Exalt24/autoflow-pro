"""The Lambda function behind the order queue.

Event source: SQS, with ReportBatchItemFailures on. For each message it validates the body, creates the order once
and runs the saga. It returns the ids of the messages that failed, and the queue redelivers only those; after
`maxReceiveCount` receives the queue moves a message to the dead-letter queue by itself.

What counts as a failure and what does not:
  a malformed body, a crash, a stuck dependency      failure: the message comes back and ends in the DLQ if it keeps failing
  a duplicate message for an order that is done      success: it was already handled, so it is deleted
  a saga that ended in a compensation (cancelled)    success: the order was processed, its outcome is CANCELLED
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable

from . import store
from .events import ORDER_CANCELLED, ORDER_CONFIRMED, EventPublisher
from .saga import asl

log = logging.getLogger("orders.handler")

SagaRunner = Callable[[dict[str, Any]], asl.Execution]


@dataclass
class Dependencies:
    ddb: Any
    run_saga: SagaRunner
    publisher: EventPublisher | None = None
    table: str = store.TABLE


def process_message(deps: Dependencies, body: Any) -> str:
    """Handle one message body. Returns CONFIRMED or CANCELLED; raises for anything the queue should retry."""
    order = store.parse_order(body)  # InvalidOrder is a poison message
    try:
        store.place_order(deps.ddb, order, deps.table)
    except store.DuplicateOrder:
        order = store.get_order(deps.ddb, order.order_id, deps.table)
        if order.status in (store.CONFIRMED, store.CANCELLED):
            return order.status  # done before, nothing to repeat
        # a delivery that crashed half way: the saga steps are idempotent, so run it again from the start
    execution = deps.run_saga({"order_id": order.order_id, "customer_id": order.customer_id, "total_cents": order.total_cents})
    if execution.status == "SUCCEEDED":
        outcome, event = store.CONFIRMED, ORDER_CONFIRMED
    elif execution.error == "OrderCancelled":
        outcome, event = store.CANCELLED, ORDER_CANCELLED
    else:
        raise RuntimeError(f"saga for {order.order_id} stopped with {execution.error}: {execution.cause}")
    if deps.publisher:
        deps.publisher.publish(event, order.order_id, order.customer_id, outcome)
    return outcome


def make_handler(deps: Dependencies) -> Callable[[dict[str, Any], Any], dict[str, Any]]:
    def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
        failures = []
        for record in event.get("Records", []):
            try:
                process_message(deps, json.loads(record["body"]))
            except Exception as exc:  # noqa: BLE001
                log.warning("message %s failed on receive %s: %s", record["messageId"], record["attributes"]["ApproximateReceiveCount"], exc)
                failures.append({"itemIdentifier": record["messageId"]})
        return {"batchItemFailures": failures}

    return handler
