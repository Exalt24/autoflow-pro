"""Publish what happened to an order to an SNS topic and an EventBridge bus, for consumers this service does not know.

SNS carries the event type as a message attribute so a subscription can filter on it. EventBridge carries it as the
`detail-type`, which is what a rule's event pattern matches on.
"""
from __future__ import annotations

import json
from typing import Any

SOURCE = "orders"
ORDER_CONFIRMED = "OrderConfirmed"
ORDER_CANCELLED = "OrderCancelled"


class PublishError(Exception):
    pass


class EventPublisher:
    def __init__(self, sns: Any | None = None, topic_arn: str | None = None, events: Any | None = None, bus_name: str | None = None):
        self.sns, self.topic_arn = sns, topic_arn
        self.events, self.bus_name = events, bus_name

    def publish(self, event_type: str, order_id: str, customer_id: str, status: str) -> None:
        detail = {"order_id": order_id, "customer_id": customer_id, "status": status}
        if self.sns and self.topic_arn:
            self.sns.publish(
                TopicArn=self.topic_arn,
                Message=json.dumps(detail),
                MessageAttributes={"eventType": {"DataType": "String", "StringValue": event_type}},
            )
        if self.events and self.bus_name:
            resp = self.events.put_events(
                Entries=[{"Source": SOURCE, "DetailType": event_type, "Detail": json.dumps(detail), "EventBusName": self.bus_name}]
            )
            # put_events returns 200 even when an entry was rejected: the count is the only signal
            if resp.get("FailedEntryCount", 0):
                raise PublishError(f"EventBridge rejected {resp['FailedEntryCount']} entry for {order_id}")
