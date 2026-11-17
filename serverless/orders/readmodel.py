"""Query side (CQRS): a read model built from the order table's DynamoDB stream.

The command side (store.py) writes orders. This side listens to the stream and keeps a separate table shaped for
the questions the screens ask: all orders of a customer, all orders in a status. The read model is eventually
consistent: it is behind until the stream has been consumed.

Stream records can repeat and, across shards, arrive out of order, so a projection only applies a record whose
order `version` is newer than the one already stored. The version is the one the command side bumps on every
transition, which is what makes this safe.
"""
from __future__ import annotations

from typing import Any, Callable

from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError

VIEW_TABLE = "order_views"
_deserialize = TypeDeserializer().deserialize


def create_view_table(ddb: Any, name: str = VIEW_TABLE) -> None:
    ddb.create_table(
        TableName=name,
        BillingMode="PAY_PER_REQUEST",
        KeySchema=[{"AttributeName": "customer_id", "KeyType": "HASH"}, {"AttributeName": "order_id", "KeyType": "RANGE"}],
        AttributeDefinitions=[
            {"AttributeName": "customer_id", "AttributeType": "S"},
            {"AttributeName": "order_id", "AttributeType": "S"},
            {"AttributeName": "status", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "by_status",
                "KeySchema": [{"AttributeName": "status", "KeyType": "HASH"}, {"AttributeName": "order_id", "KeyType": "RANGE"}],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )


def _image(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    return {k: _deserialize(v) for k, v in raw.items()} if raw else None


def _is_meta(image: dict[str, Any] | None) -> bool:
    return bool(image) and image.get("SK") == "META"


def project_record(ddb: Any, record: dict[str, Any], table: str = VIEW_TABLE) -> str:
    """Apply one stream record to the read model. Returns what happened: applied, stale, ignored or deleted."""
    change = record["dynamodb"]
    new, old = _image(change.get("NewImage")), _image(change.get("OldImage"))
    if record["eventName"] == "REMOVE":
        if not _is_meta(old):
            return "ignored"
        ddb.delete_item(
            TableName=table,
            Key={"customer_id": old["customer_id"], "order_id": old["order_id"]},
        )
        return "deleted"
    if not _is_meta(new):
        return "ignored"  # lines, stock and reservations share the table but are not part of the read model
    try:
        ddb.put_item(
            TableName=table,
            Item={
                "customer_id": new["customer_id"],
                "order_id": new["order_id"],
                "status": new["status"],
                "version": int(new["version"]),
                "total_cents": int(new["total_cents"]),
                "line_count": int(new["line_count"]),
                "created_at": new["created_at"],
            },
            ConditionExpression="attribute_not_exists(order_id) OR #v < :v",
            ExpressionAttributeNames={"#v": "version"},
            ExpressionAttributeValues={":v": int(new["version"])},
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return "stale"
        raise
    return "applied"


def make_stream_handler(ddb: Any, table: str = VIEW_TABLE) -> Callable[[dict[str, Any], Any], dict[str, Any]]:
    """A Lambda handler for a DynamoDB stream event source with ReportBatchItemFailures."""

    def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
        failures = []
        for record in event.get("Records", []):
            try:
                project_record(ddb, record, table)
            except Exception:  # noqa: BLE001
                # report the first failure and stop: records after it must not be applied before it succeeds
                failures.append({"itemIdentifier": record["dynamodb"]["SequenceNumber"]})
                break
        return {"batchItemFailures": failures}

    return handler


class StreamPoller:
    """Stand-in for the stream event source mapping: reads every shard from a checkpoint and invokes the handler."""

    def __init__(self, streams: Any, stream_arn: str, handler: Callable[[dict[str, Any], Any], dict[str, Any]]):
        self.streams = streams
        self.stream_arn = stream_arn
        self.handler = handler
        self.checkpoint: dict[str, str] = {}  # shard id -> last sequence number handled

    def poll(self, limit: int = 100) -> int:
        handled = 0
        desc = self.streams.describe_stream(StreamArn=self.stream_arn)["StreamDescription"]
        for shard in desc["Shards"]:
            shard_id = shard["ShardId"]
            if shard_id in self.checkpoint:
                iterator = self.streams.get_shard_iterator(
                    StreamArn=self.stream_arn,
                    ShardId=shard_id,
                    ShardIteratorType="AFTER_SEQUENCE_NUMBER",
                    SequenceNumber=self.checkpoint[shard_id],
                )["ShardIterator"]
            else:
                iterator = self.streams.get_shard_iterator(StreamArn=self.stream_arn, ShardId=shard_id, ShardIteratorType="TRIM_HORIZON")["ShardIterator"]
            records = self.streams.get_records(ShardIterator=iterator, Limit=limit)["Records"]
            if not records:
                continue
            result = self.handler({"Records": records}, None) or {}
            failed = {f["itemIdentifier"] for f in result.get("batchItemFailures", [])}
            for record in records:
                seq = record["dynamodb"]["SequenceNumber"]
                if seq in failed:
                    break  # the batch resumes from the failed record on the next poll
                self.checkpoint[shard_id] = seq
                handled += 1
        return handled


def _plain(item: dict[str, Any]) -> dict[str, Any]:
    return {k: int(v) if hasattr(v, "to_integral_value") else v for k, v in item.items()}


def orders_for_customer(ddb: Any, customer_id: str, table: str = VIEW_TABLE) -> list[dict[str, Any]]:
    resp = ddb.query(TableName=table, KeyConditionExpression="customer_id = :c", ExpressionAttributeValues={":c": customer_id})
    return [_plain(i) for i in resp["Items"]]


def orders_by_status(ddb: Any, status: str, table: str = VIEW_TABLE) -> list[dict[str, Any]]:
    resp = ddb.query(
        TableName=table,
        IndexName="by_status",
        KeyConditionExpression="#s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": status},
    )
    return [_plain(i) for i in resp["Items"]]


def get_view(ddb: Any, customer_id: str, order_id: str, table: str = VIEW_TABLE) -> dict[str, Any] | None:
    item = ddb.get_item(TableName=table, Key={"customer_id": customer_id, "order_id": order_id}).get("Item")
    return _plain(item) if item else None
