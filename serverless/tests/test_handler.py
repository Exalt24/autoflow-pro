"""The whole path: SQS message, Lambda handler, saga, DynamoDB, stream, read model, events. All against moto."""
import json

import pytest

from orders import readmodel, store
from orders.events import EventPublisher, PublishError
from orders.handler import Dependencies, make_handler
from orders.messaging import dlq_depth, drain, read_dlq
from orders.readmodel import StreamPoller, make_stream_handler

from helpers import order_body


@pytest.fixture
def pipeline(world, queues):
    world.queues = queues
    world.publisher = None
    world.handler = lambda: make_handler(Dependencies(world.ddb, world.run_saga, world.publisher))
    world.send = lambda body: world.sqs.send_message(QueueUrl=queues.url, MessageBody=body if isinstance(body, str) else json.dumps(body))
    world.drain = lambda handler=None: drain(world.sqs, queues, handler or world.handler())
    return world


def test_a_message_becomes_a_confirmed_order_and_reaches_the_read_model(pipeline):
    store.seed_stock(pipeline.ddb, "widget", 10)
    pipeline.send(order_body())
    assert pipeline.drain() == {"received": 1, "deleted": 1, "failed": 0}
    assert store.get_order(pipeline.ddb, "o1").status == store.CONFIRMED
    assert readmodel.get_view(pipeline.ddb, "c1", "o1") is None  # the query side is behind until the stream is read
    StreamPoller(pipeline.streams, pipeline.stream_arn, make_stream_handler(pipeline.ddb)).poll()
    view = readmodel.get_view(pipeline.ddb, "c1", "o1")
    assert (view["status"], view["total_cents"]) == ("CONFIRMED", 1000)
    assert dlq_depth(pipeline.sqs, pipeline.queues) == 0


def test_a_message_delivered_twice_is_processed_once(pipeline):
    store.seed_stock(pipeline.ddb, "widget", 10)
    pipeline.send(order_body())
    pipeline.send(order_body())
    pipeline.drain()
    assert store.stock_of(pipeline.ddb, "widget") == 8
    assert pipeline.payments.charges == {"order-o1": 1000}
    assert pipeline.carrier.shipments == {"order-o1": "trk_order-o1"}


def test_poison_messages_end_in_the_dead_letter_queue_and_good_ones_in_the_same_batch_are_processed(pipeline):
    store.seed_stock(pipeline.ddb, "widget", 10)
    pipeline.send("this is not json")
    pipeline.send({"order_id": "bad", "customer_id": "c9", "lines": []})
    pipeline.send(order_body("o1"))
    pipeline.send(order_body("o2", customer_id="c2"))
    pipeline.drain()
    assert {store.get_order(pipeline.ddb, o).status for o in ("o1", "o2")} == {store.CONFIRMED}
    assert dlq_depth(pipeline.sqs, pipeline.queues) == 2
    bodies = sorted(m["Body"] for m in read_dlq(pipeline.sqs, pipeline.queues))
    assert bodies == sorted(["this is not json", json.dumps({"order_id": "bad", "customer_id": "c9", "lines": []})])
    with pytest.raises(store.OrderNotFound):
        store.get_order(pipeline.ddb, "bad")  # nothing was written for a poison message


def test_a_declined_order_is_a_finished_order_and_not_a_dead_letter(pipeline):
    store.seed_stock(pipeline.ddb, "widget", 10)
    pipeline.payments.declined_customers.add("c1")
    pipeline.send(order_body())
    assert pipeline.drain() == {"received": 1, "deleted": 1, "failed": 0}
    assert store.get_order(pipeline.ddb, "o1").status == store.CANCELLED
    assert dlq_depth(pipeline.sqs, pipeline.queues) == 0


def test_a_worker_that_dies_mid_saga_is_retried_and_finishes_the_order_without_repeating_work(pipeline):
    store.seed_stock(pipeline.ddb, "widget", 10)

    class WorkerDied(BaseException):
        """Not an Exception: it escapes the runner the way a killed process would."""

    ship = next(k for k in pipeline.tasks if k.endswith("create-shipment"))
    real, state = pipeline.tasks[ship], {"died": False}

    def die_once(payload):
        if not state["died"]:
            state["died"] = True
            raise WorkerDied()
        return real(payload)

    pipeline.tasks[ship] = die_once
    inner = pipeline.handler()

    def lambda_runtime(event, context):
        try:
            return inner(event, context)
        except WorkerDied as exc:
            raise RuntimeError("invocation failed") from exc

    pipeline.send(order_body())
    pipeline.drain(lambda_runtime)
    assert store.get_order(pipeline.ddb, "o1").status == store.CONFIRMED
    assert store.stock_of(pipeline.ddb, "widget") == 8  # reserved once, though the saga ran from the top twice
    assert pipeline.payments.charges == {"order-o1": 1000}
    assert dlq_depth(pipeline.sqs, pipeline.queues) == 0


def test_a_crash_after_the_saga_but_before_the_delete_does_not_charge_again(pipeline):
    store.seed_stock(pipeline.ddb, "widget", 10)
    inner, state = pipeline.handler(), {"crashed": False}

    def crash_after_work(event, context):
        result = inner(event, context)
        if not state["crashed"]:
            state["crashed"] = True
            raise RuntimeError("the function timed out before returning")
        return result

    pipeline.send(order_body())
    pipeline.drain(crash_after_work)
    assert pipeline.payments.charges == {"order-o1": 1000}
    assert store.stock_of(pipeline.ddb, "widget") == 8
    assert dlq_depth(pipeline.sqs, pipeline.queues) == 0


def test_a_saga_that_stops_without_a_verdict_is_retried_not_lost(pipeline):
    store.seed_stock(pipeline.ddb, "widget", 10)
    # a compensation that never succeeds leaves the saga without OrderCancelled: the message must come back
    pipeline.payments.declined_customers.add("c1")
    refund = next(k for k in pipeline.tasks if k.endswith("refund-payment"))
    pipeline.tasks[refund] = lambda state: (_ for _ in ()).throw(RuntimeError("provider down"))
    pipeline.send(order_body())
    pipeline.drain()
    assert dlq_depth(pipeline.sqs, pipeline.queues) == 1  # after three receives it is dead-lettered with its order state intact
    assert store.get_order(pipeline.ddb, "o1").status in (store.PENDING, store.RESERVED)


def test_outcomes_are_published_to_sns_and_eventbridge(pipeline):
    sns, events, sqs = pipeline.sns, pipeline.events, pipeline.sqs
    out = sqs.create_queue(QueueName="downstream")["QueueUrl"]
    out_arn = sqs.get_queue_attributes(QueueUrl=out, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    topic = sns.create_topic(Name="order-events")["TopicArn"]
    sns.subscribe(TopicArn=topic, Protocol="sqs", Endpoint=out_arn, Attributes={"RawMessageDelivery": "true"})
    events.create_event_bus(Name="orders")
    confirmed_q = sqs.create_queue(QueueName="confirmed-only")["QueueUrl"]
    confirmed_arn = sqs.get_queue_attributes(QueueUrl=confirmed_q, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    events.put_rule(Name="confirmed", EventBusName="orders", EventPattern=json.dumps({"source": ["orders"], "detail-type": ["OrderConfirmed"]}))
    events.put_targets(Rule="confirmed", EventBusName="orders", Targets=[{"Id": "q", "Arn": confirmed_arn}])
    pipeline.publisher = EventPublisher(sns, topic, events, "orders")

    store.seed_stock(pipeline.ddb, "widget", 10)
    pipeline.payments.declined_customers.add("c2")
    pipeline.send(order_body("ok", "c1"))
    pipeline.send(order_body("declined", "c2"))
    pipeline.drain()

    published = [json.loads(m["Body"]) for m in sqs.receive_message(QueueUrl=out, MaxNumberOfMessages=10).get("Messages", [])]
    assert sorted((p["order_id"], p["status"]) for p in published) == [("declined", "CANCELLED"), ("ok", "CONFIRMED")]
    routed = [json.loads(m["Body"]) for m in sqs.receive_message(QueueUrl=confirmed_q, MaxNumberOfMessages=10).get("Messages", [])]
    assert [(r["detail-type"], r["detail"]["order_id"]) for r in routed] == [("OrderConfirmed", "ok")]  # the rule matched one type only


def test_an_eventbridge_entry_that_is_rejected_is_an_error_not_a_silent_loss():
    class Rejecting:
        def put_events(self, **kwargs):
            return {"FailedEntryCount": 1, "Entries": [{"ErrorCode": "InternalFailure"}]}

    with pytest.raises(PublishError):
        EventPublisher(events=Rejecting(), bus_name="orders").publish("OrderConfirmed", "o1", "c1", "CONFIRMED")
