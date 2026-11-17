"""The Lambda functions the state machine calls, one per Task, wired to a Resource ARN.

Every function takes the state input and returns a result, so each one can run as a Lambda handler or inside the
local runner. Each one is idempotent: Step Functions may retry a task, and the compensations may run again.
"""
from __future__ import annotations

import json
import os
from typing import Any, Callable

from .. import store
from ..standins import FakeCarrier, FakePaymentProvider

DEFINITION_PATH = os.path.join(os.path.dirname(__file__), "order_saga.asl.json")
ACCOUNT_REGION = "arn:aws:lambda:ap-southeast-2:123456789012:function:orders-"


def build_tasks(ddb: Any, payments: FakePaymentProvider, carrier: FakeCarrier, table: str = store.TABLE) -> dict[str, Callable[[dict[str, Any]], Any]]:
    def order_of(state: dict[str, Any]) -> store.Order:
        return store.get_order(ddb, state["order_id"], table)

    def reserve_inventory(state: dict[str, Any]) -> dict[str, Any]:
        order = order_of(state)
        store.reserve_stock(ddb, order, table)
        store.move_to(ddb, order.order_id, store.RESERVED, table=table)
        return {"reserved": True}

    def charge_payment(state: dict[str, Any]) -> dict[str, Any]:
        order = order_of(state)
        payment_id = payments.charge(f"order-{order.order_id}", order.customer_id, order.total_cents)
        store.record_payment(ddb, order.order_id, payment_id, order.total_cents, table)
        store.move_to(ddb, order.order_id, store.PAID, table=table)
        return {"payment_id": payment_id}

    def create_shipment(state: dict[str, Any]) -> dict[str, Any]:
        order = order_of(state)
        tracking = carrier.ship(f"order-{order.order_id}")
        store.move_to(ddb, order.order_id, store.SHIPPED, table=table)
        return {"tracking_id": tracking}

    def confirm_order(state: dict[str, Any]) -> dict[str, Any]:
        store.move_to(ddb, state["order_id"], store.CONFIRMED, table=table)
        return {"confirmed": True}

    def cancel_shipment(state: dict[str, Any]) -> dict[str, Any]:
        return {"cancelled": carrier.cancel(f"order-{state['order_id']}")}

    def refund_payment(state: dict[str, Any]) -> dict[str, Any]:
        # Refund by order id, not by what the state remembers: a charge that timed out may still have gone through.
        refunded = payments.refund(f"order-{state['order_id']}")
        store.clear_payment(ddb, state["order_id"], table)
        return {"refunded": refunded}

    def release_inventory(state: dict[str, Any]) -> dict[str, Any]:
        return {"released": store.release_stock(ddb, order_of(state), table)}

    def cancel_order(state: dict[str, Any]) -> dict[str, Any]:
        store.move_to(ddb, state["order_id"], store.CANCELLED, table=table)
        return {"cancelled": True}

    functions = {
        "reserve-inventory": reserve_inventory,
        "charge-payment": charge_payment,
        "create-shipment": create_shipment,
        "confirm-order": confirm_order,
        "cancel-shipment": cancel_shipment,
        "refund-payment": refund_payment,
        "release-inventory": release_inventory,
        "cancel-order": cancel_order,
    }
    return {ACCOUNT_REGION + name: fn for name, fn in functions.items()}


def load_saga() -> dict[str, Any]:
    with open(DEFINITION_PATH, encoding="utf-8") as fh:
        return json.load(fh)
