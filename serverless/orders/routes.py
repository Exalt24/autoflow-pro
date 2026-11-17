"""Two implementations of the same two read routes, to put behind the strangler router.

legacy_app    the old system: orders kept in a plain dict the way a monolith's table would be read
modern_app    the new system: the same answers from the DynamoDB read model

Both take the router's call dict and return {"statusCode", "body"}. Both must answer the same way for the same call,
which is what the parity test in tests/test_strangler.py checks before a route is allowed to move.
"""
from __future__ import annotations

from typing import Any, Callable

from . import readmodel

ROUTES = ("GET /customers/{customer_id}/orders", "GET /orders/{order_id}")


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    return {"order_id": row["order_id"], "status": row["status"], "total_cents": row["total_cents"]}


def _dispatch(call: dict[str, Any], by_customer: Callable[[str], list[dict[str, Any]]], by_order: Callable[[str, str], dict[str, Any] | None]) -> dict[str, Any]:
    params = call["params"]
    if "order_id" in params:
        customer_id = call["query"].get("customer_id")
        if not customer_id:
            return {"statusCode": 400, "body": {"error": "customer_id is required"}}
        row = by_order(customer_id, params["order_id"])
        if row is None:
            return {"statusCode": 404, "body": {"error": "order not found"}}
        return {"statusCode": 200, "body": {**_summary(row), "customer_id": customer_id}}
    if "customer_id" in params:
        rows = sorted(by_customer(params["customer_id"]), key=lambda r: r["order_id"])
        return {"statusCode": 200, "body": {"orders": [_summary(r) for r in rows]}}
    return {"statusCode": 404, "body": {"error": "no such route"}}


def legacy_app(db: dict[tuple[str, str], dict[str, Any]]) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """`db` maps (customer_id, order_id) to a row with order_id, status and total_cents."""
    return lambda call: _dispatch(
        call,
        lambda cid: [row for (c, _), row in db.items() if c == cid],
        lambda cid, oid: db.get((cid, oid)),
    )


def modern_app(ddb: Any, table: str = readmodel.VIEW_TABLE) -> Callable[[dict[str, Any]], dict[str, Any]]:
    return lambda call: _dispatch(
        call,
        lambda cid: readmodel.orders_for_customer(ddb, cid, table),
        lambda cid, oid: readmodel.get_view(ddb, cid, oid, table),
    )
