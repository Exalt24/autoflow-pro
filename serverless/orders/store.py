"""Command side: one DynamoDB table holds orders, line items, stock and reservations (single table design).

Key layout (partition key PK, sort key SK, one global secondary index GSI1):

    ORDER#<id>   META               the order header: status, version, total, customer
    ORDER#<id>   LINE#<n>           one line item
    ORDER#<id>   RESERVATION#<sku>  stock held for this order, so a release can be repeated safely
    ORDER#<id>   PAYMENT            the charge recorded for this order
    SKU#<sku>    STOCK              units available

Every write that must not happen twice or out of order carries a ConditionExpression:
    create      attribute_not_exists(PK)                     a redelivered message creates nothing
    transition  version = :expected AND status IN :allowed   optimistic locking, then a legal state change
    reserve     available >= :qty                            stock never goes negative

`ddb` is the low level client of a boto3 DynamoDB resource: boto3.resource("dynamodb").meta.client.
It takes plain Python values, including in transact_write_items.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from botocore.exceptions import ClientError

TABLE = "orders"

PENDING, RESERVED, PAID, SHIPPED, CONFIRMED, CANCELLED = (
    "PENDING", "RESERVED", "PAID", "SHIPPED", "CONFIRMED", "CANCELLED",
)
# target status -> the statuses it may be reached from
ALLOWED_FROM: dict[str, tuple[str, ...]] = {
    RESERVED: (PENDING,),
    PAID: (RESERVED,),
    SHIPPED: (PAID, RESERVED),  # a zero total order ships without a payment
    CONFIRMED: (SHIPPED,),
    CANCELLED: (PENDING, RESERVED, PAID, SHIPPED, CONFIRMED),  # a confirmed order can still be cancelled
}


FORWARD = (PENDING, RESERVED, PAID, SHIPPED, CONFIRMED)


class DuplicateOrder(Exception):
    pass


class VersionConflict(Exception):
    pass


class IllegalTransition(Exception):
    pass


class OutOfStock(Exception):
    pass


class OrderNotFound(Exception):
    pass


class InvalidOrder(Exception):
    pass


@dataclass
class Line:
    sku: str
    qty: int
    price_cents: int


@dataclass
class Order:
    order_id: str
    customer_id: str
    lines: list[Line]
    status: str = PENDING
    version: int = 1
    total_cents: int = 0
    created_at: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


def parse_order(body: Any) -> Order:
    """Turn a message body into an Order or raise InvalidOrder. This is the poison message check."""
    if not isinstance(body, dict):
        raise InvalidOrder("the body must be a JSON object")
    try:
        order_id = str(body["order_id"])
        customer_id = str(body["customer_id"])
        raw_lines = body["lines"]
    except KeyError as exc:
        raise InvalidOrder(f"missing field {exc}") from exc
    if not order_id or not customer_id:
        raise InvalidOrder("order_id and customer_id must not be empty")
    if not isinstance(raw_lines, list) or not raw_lines:
        raise InvalidOrder("an order needs at least one line")
    lines = []
    for raw in raw_lines:
        try:
            line = Line(str(raw["sku"]), int(raw["qty"]), int(raw["price_cents"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise InvalidOrder(f"bad line {raw!r}") from exc
        if line.qty < 1 or line.price_cents < 0 or not line.sku:
            raise InvalidOrder(f"bad line {raw!r}")
        lines.append(line)
    if len({line.sku for line in lines}) != len(lines):
        raise InvalidOrder("a sku may appear once per order")
    return Order(order_id, customer_id, lines, total_cents=sum(l.qty * l.price_cents for l in lines))


def create_table(ddb: Any, name: str = TABLE) -> None:
    ddb.create_table(
        TableName=name,
        BillingMode="PAY_PER_REQUEST",
        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
            {"AttributeName": "GSI1PK", "AttributeType": "S"},
            {"AttributeName": "GSI1SK", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "GSI1",
                "KeySchema": [{"AttributeName": "GSI1PK", "KeyType": "HASH"}, {"AttributeName": "GSI1SK", "KeyType": "RANGE"}],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
        StreamSpecification={"StreamEnabled": True, "StreamViewType": "NEW_AND_OLD_IMAGES"},
    )


def seed_stock(ddb: Any, sku: str, available: int, table: str = TABLE) -> None:
    ddb.put_item(TableName=table, Item={"PK": f"SKU#{sku}", "SK": "STOCK", "available": available})


def stock_of(ddb: Any, sku: str, table: str = TABLE) -> int:
    item = ddb.get_item(TableName=table, Key={"PK": f"SKU#{sku}", "SK": "STOCK"}, ConsistentRead=True).get("Item")
    return int(item["available"]) if item else 0


def _code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


def _cancel_codes(exc: ClientError) -> list[str]:
    return [r.get("Code", "") for r in exc.response.get("CancellationReasons", [])]


def place_order(ddb: Any, order: Order, table: str = TABLE) -> Order:
    """Create the header and the lines in one transaction. A second call for the same id raises DuplicateOrder."""
    items: list[dict[str, Any]] = [
        {
            "Put": {
                "TableName": table,
                "Item": {
                    "PK": f"ORDER#{order.order_id}",
                    "SK": "META",
                    "order_id": order.order_id,
                    "customer_id": order.customer_id,
                    "status": order.status,
                    "version": order.version,
                    "total_cents": order.total_cents,
                    "line_count": len(order.lines),
                    "created_at": order.created_at,
                    "GSI1PK": f"CUSTOMER#{order.customer_id}",
                    "GSI1SK": f"{order.created_at}#{order.order_id}",
                },
                "ConditionExpression": "attribute_not_exists(PK)",
            }
        }
    ]
    for n, line in enumerate(order.lines, start=1):
        items.append(
            {
                "Put": {
                    "TableName": table,
                    "Item": {"PK": f"ORDER#{order.order_id}", "SK": f"LINE#{n:03d}", "sku": line.sku, "qty": line.qty, "price_cents": line.price_cents},
                }
            }
        )
    try:
        ddb.transact_write_items(TransactItems=items)
    except ClientError as exc:
        if _code(exc) == "TransactionCanceledException" and "ConditionalCheckFailed" in _cancel_codes(exc):
            raise DuplicateOrder(order.order_id) from exc
        raise
    return order


def get_order(ddb: Any, order_id: str, table: str = TABLE) -> Order:
    meta = ddb.get_item(TableName=table, Key={"PK": f"ORDER#{order_id}", "SK": "META"}, ConsistentRead=True).get("Item")
    if not meta:
        raise OrderNotFound(order_id)
    resp = ddb.query(
        TableName=table,
        KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues={":pk": f"ORDER#{order_id}", ":p": "LINE#"},
        ConsistentRead=True,
    )
    lines = [Line(i["sku"], int(i["qty"]), int(i["price_cents"])) for i in resp["Items"]]
    return Order(
        order_id=meta["order_id"],
        customer_id=meta["customer_id"],
        lines=lines,
        status=meta["status"],
        version=int(meta["version"]),
        total_cents=int(meta["total_cents"]),
        created_at=meta["created_at"],
    )


def transition(ddb: Any, order_id: str, to_status: str, expected_version: int, table: str = TABLE) -> int:
    """Move an order to a new status if nobody changed it since `expected_version`. Returns the new version."""
    values: dict[str, Any] = {":to": to_status, ":ev": expected_version, ":nv": expected_version + 1}
    status_in = []
    for n, prior in enumerate(ALLOWED_FROM[to_status]):
        values[f":a{n}"] = prior
        status_in.append(f":a{n}")
    try:
        ddb.update_item(
            TableName=table,
            Key={"PK": f"ORDER#{order_id}", "SK": "META"},
            UpdateExpression="SET #s = :to, #v = :nv",
            ConditionExpression=f"attribute_exists(PK) AND #v = :ev AND #s IN ({', '.join(status_in)})",
            ExpressionAttributeNames={"#s": "status", "#v": "version"},
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if _code(exc) != "ConditionalCheckFailedException":
            raise
        current = get_order(ddb, order_id, table)  # raises OrderNotFound when it is gone
        if current.version != expected_version:
            raise VersionConflict(f"{order_id}: expected version {expected_version}, found {current.version}") from exc
        raise IllegalTransition(f"{order_id}: {current.status} -> {to_status}") from exc
    return expected_version + 1


def move_to(ddb: Any, order_id: str, to_status: str, attempts: int = 5, table: str = TABLE) -> Order:
    """Read, then transition, and read again when another writer won the race.

    Already in `to_status`, or past it on the forward path, is a no-op, so a step that Step Functions retries or a
    saga that restarts after a crash does not trip over its own earlier work.
    """
    for _ in range(attempts):
        current = get_order(ddb, order_id, table)
        if current.status == to_status or (to_status in FORWARD and current.status in FORWARD and FORWARD.index(current.status) >= FORWARD.index(to_status)):
            return current
        try:
            transition(ddb, order_id, to_status, current.version, table)
        except VersionConflict:
            continue
        return get_order(ddb, order_id, table)
    raise VersionConflict(f"{order_id}: still conflicting after {attempts} attempts")


def reserve_stock(ddb: Any, order: Order, table: str = TABLE) -> None:
    """Hold every line's stock in one transaction: all lines are reserved or none are. Repeating it changes nothing."""
    items: list[dict[str, Any]] = []
    for line in order.lines:
        items.append(
            {
                "Update": {
                    "TableName": table,
                    "Key": {"PK": f"SKU#{line.sku}", "SK": "STOCK"},
                    "UpdateExpression": "SET available = available - :q",
                    "ConditionExpression": "available >= :q",
                    "ExpressionAttributeValues": {":q": line.qty},
                }
            }
        )
        items.append(
            {
                "Put": {
                    "TableName": table,
                    "Item": {"PK": f"ORDER#{order.order_id}", "SK": f"RESERVATION#{line.sku}", "qty": line.qty},
                    "ConditionExpression": "attribute_not_exists(PK)",
                }
            }
        )
    try:
        ddb.transact_write_items(TransactItems=items)
    except ClientError as exc:
        if _code(exc) != "TransactionCanceledException":
            raise
        # the reservation Put is the second item of each pair: it fails when this order already holds the stock
        if any(r == "ConditionalCheckFailed" for r in _cancel_codes(exc)[1::2]) and _holds_all(ddb, order, table):
            return
        raise OutOfStock(order.order_id) from exc


def _holds_all(ddb: Any, order: Order, table: str) -> bool:
    for line in order.lines:
        key = {"PK": f"ORDER#{order.order_id}", "SK": f"RESERVATION#{line.sku}"}
        if not ddb.get_item(TableName=table, Key=key, ConsistentRead=True).get("Item"):
            return False
    return True


def release_stock(ddb: Any, order: Order, table: str = TABLE) -> int:
    """Compensation for reserve_stock. Gives back only what this order still holds, so it can run twice."""
    released = 0
    for line in order.lines:
        key = {"PK": f"ORDER#{order.order_id}", "SK": f"RESERVATION#{line.sku}"}
        item = ddb.get_item(TableName=table, Key=key, ConsistentRead=True).get("Item")
        if not item:
            continue
        qty = int(item["qty"])
        try:
            ddb.transact_write_items(
                TransactItems=[
                    {"Delete": {"TableName": table, "Key": key, "ConditionExpression": "attribute_exists(PK)"}},
                    {
                        "Update": {
                            "TableName": table,
                            "Key": {"PK": f"SKU#{line.sku}", "SK": "STOCK"},
                            "UpdateExpression": "SET available = available + :q",
                            "ExpressionAttributeValues": {":q": qty},
                        }
                    },
                ]
            )
            released += qty
        except ClientError as exc:
            if _code(exc) == "TransactionCanceledException" and "ConditionalCheckFailed" in _cancel_codes(exc):
                continue  # a concurrent run released it first
            raise
    return released


def record_payment(ddb: Any, order_id: str, payment_id: str, amount_cents: int, table: str = TABLE) -> None:
    ddb.put_item(TableName=table, Item={"PK": f"ORDER#{order_id}", "SK": "PAYMENT", "payment_id": payment_id, "amount_cents": amount_cents})


def get_payment(ddb: Any, order_id: str, table: str = TABLE) -> dict[str, Any] | None:
    return ddb.get_item(TableName=table, Key={"PK": f"ORDER#{order_id}", "SK": "PAYMENT"}, ConsistentRead=True).get("Item")


def clear_payment(ddb: Any, order_id: str, table: str = TABLE) -> None:
    ddb.delete_item(TableName=table, Key={"PK": f"ORDER#{order_id}", "SK": "PAYMENT"})
