"""CQRS read side: a read model built from the DynamoDB stream, against moto's stream."""
from orders import readmodel, store
from orders.readmodel import StreamPoller, make_stream_handler

from helpers import order_body


def record(event, order_id="o1", customer="c1", status="PENDING", version=1, total=1000, sk="META"):
    image = {
        "PK": {"S": f"ORDER#{order_id}"}, "SK": {"S": sk}, "order_id": {"S": order_id}, "customer_id": {"S": customer},
        "status": {"S": status}, "version": {"N": str(version)}, "total_cents": {"N": str(total)},
        "line_count": {"N": "1"}, "created_at": {"S": "2026-11-17T00:00:00Z"},
    }
    body = {"Keys": {"PK": image["PK"], "SK": image["SK"]}, "SequenceNumber": str(version * 10), "StreamViewType": "NEW_AND_OLD_IMAGES"}
    if event == "REMOVE":
        body["OldImage"] = image
    else:
        body["NewImage"] = image
    return {"eventID": f"e{version}", "eventName": event, "eventSource": "aws:dynamodb", "dynamodb": body}


def test_the_read_model_is_empty_until_the_stream_is_consumed(tables):
    store.place_order(tables.ddb, store.parse_order(order_body()))
    assert readmodel.orders_for_customer(tables.ddb, "c1") == []  # eventually consistent: behind the writes


def test_a_new_order_and_its_transitions_reach_the_read_model(tables):
    poller = StreamPoller(tables.streams, tables.stream_arn, make_stream_handler(tables.ddb))
    store.place_order(tables.ddb, store.parse_order(order_body()))
    store.transition(tables.ddb, "o1", store.RESERVED, 1)
    store.transition(tables.ddb, "o1", store.PAID, 2)
    poller.poll()
    view = readmodel.get_view(tables.ddb, "c1", "o1")
    assert (view["status"], view["version"], view["total_cents"], view["line_count"]) == ("PAID", 3, 1000, 1)


def test_lines_stock_and_reservations_do_not_leak_into_the_read_model(tables):
    store.seed_stock(tables.ddb, "widget", 5)
    order = store.place_order(tables.ddb, store.parse_order(order_body()))
    store.reserve_stock(tables.ddb, order)
    store.record_payment(tables.ddb, "o1", "pay_1", 1000)
    StreamPoller(tables.streams, tables.stream_arn, make_stream_handler(tables.ddb)).poll()
    assert [v["order_id"] for v in readmodel.orders_for_customer(tables.ddb, "c1")] == ["o1"]


def test_polling_again_handles_only_what_is_new(tables):
    poller = StreamPoller(tables.streams, tables.stream_arn, make_stream_handler(tables.ddb))
    store.place_order(tables.ddb, store.parse_order(order_body()))
    first = poller.poll()
    assert first >= 2 and poller.poll() == 0
    store.transition(tables.ddb, "o1", store.RESERVED, 1)
    assert poller.poll() == 1


def test_a_stale_record_does_not_overwrite_a_newer_view(tables):
    readmodel.project_record(tables.ddb, record("MODIFY", status="PAID", version=3))
    assert readmodel.project_record(tables.ddb, record("MODIFY", status="RESERVED", version=2)) == "stale"
    assert readmodel.get_view(tables.ddb, "c1", "o1")["status"] == "PAID"


def test_a_repeated_record_is_applied_once(tables):
    assert readmodel.project_record(tables.ddb, record("INSERT", version=1)) == "applied"
    assert readmodel.project_record(tables.ddb, record("INSERT", version=1)) == "stale"


def test_a_removed_order_leaves_the_read_model(tables):
    readmodel.project_record(tables.ddb, record("INSERT"))
    assert readmodel.project_record(tables.ddb, record("REMOVE")) == "deleted"
    assert readmodel.get_view(tables.ddb, "c1", "o1") is None


def test_records_that_are_not_order_headers_are_ignored(tables):
    assert readmodel.project_record(tables.ddb, record("INSERT", sk="LINE#001")) == "ignored"
    assert readmodel.project_record(tables.ddb, record("REMOVE", sk="PAYMENT")) == "ignored"


def test_the_view_can_be_listed_by_customer_and_by_status(tables):
    for oid, cid, status, version in [("o1", "c1", "PAID", 3), ("o2", "c1", "CANCELLED", 2), ("o3", "c2", "PAID", 3)]:
        readmodel.project_record(tables.ddb, record("INSERT", order_id=oid, customer=cid, status=status, version=version))
    assert sorted(v["order_id"] for v in readmodel.orders_for_customer(tables.ddb, "c1")) == ["o1", "o2"]
    assert sorted(v["order_id"] for v in readmodel.orders_by_status(tables.ddb, "PAID")) == ["o1", "o3"]


def test_the_handler_reports_the_failed_record_and_skips_the_ones_after_it(tables):
    calls = []

    class Broken:
        def __getattr__(self, name):
            return getattr(tables.ddb, name)

        def put_item(self, **kwargs):
            calls.append(kwargs["Item"]["order_id"])
            if kwargs["Item"]["order_id"] == "o2":
                raise RuntimeError("throttled")
            return tables.ddb.put_item(**kwargs)

    handler = make_stream_handler(Broken())
    result = handler({"Records": [record("INSERT", order_id="o1", version=1), record("INSERT", order_id="o2", version=2), record("INSERT", order_id="o3", version=3)]})
    assert result == {"batchItemFailures": [{"itemIdentifier": "20"}]}
    assert calls == ["o1", "o2"]  # o3 was not applied ahead of the failed o2


def test_a_failed_batch_resumes_from_the_failed_record(tables):
    state = {"fail": True}
    real = make_stream_handler(tables.ddb)

    def flaky(event, context):
        if state["fail"] and any(r["dynamodb"]["NewImage"].get("version", {}).get("N") == "2" for r in event["Records"] if "NewImage" in r["dynamodb"]):
            state["fail"] = False
            return {"batchItemFailures": [{"itemIdentifier": event["Records"][0]["dynamodb"]["SequenceNumber"]}]}
        return real(event, context)

    poller = StreamPoller(tables.streams, tables.stream_arn, flaky)
    store.place_order(tables.ddb, store.parse_order(order_body()))
    store.transition(tables.ddb, "o1", store.RESERVED, 1)
    poller.poll()
    assert readmodel.get_view(tables.ddb, "c1", "o1") is None  # the failed batch applied nothing and moved no checkpoint
    poller.poll()
    assert readmodel.get_view(tables.ddb, "c1", "o1")["status"] == "RESERVED"
