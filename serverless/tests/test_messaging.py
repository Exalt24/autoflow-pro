"""SQS queue with a dead-letter queue, batch handling and redrive, against moto."""
import json

import pytest

from orders.messaging import create_order_queues, dlq_depth, drain, poll_and_invoke, read_dlq, redrive_dlq


def send(aws, queues, body):
    aws.sqs.send_message(QueueUrl=queues.url, MessageBody=json.dumps(body) if not isinstance(body, str) else body)


def test_redrive_policy_points_at_the_dead_letter_queue(aws, queues):
    attrs = aws.sqs.get_queue_attributes(QueueUrl=queues.url, AttributeNames=["RedrivePolicy", "VisibilityTimeout"])["Attributes"]
    policy = json.loads(attrs["RedrivePolicy"])
    assert policy["deadLetterTargetArn"] == queues.dlq_arn
    assert int(policy["maxReceiveCount"]) == 3


def test_the_dead_letter_queue_keeps_messages_longer_than_the_source(aws, queues):
    keep = lambda url: int(aws.sqs.get_queue_attributes(QueueUrl=url, AttributeNames=["MessageRetentionPeriod"])["Attributes"]["MessageRetentionPeriod"])
    assert keep(queues.dlq_url) > keep(queues.url)


def test_a_max_receive_count_below_one_is_refused(aws):
    with pytest.raises(ValueError):
        create_order_queues(aws.sqs, "bad", max_receive_count=0)


def test_a_message_that_always_fails_is_dead_lettered_after_max_receive_count_receives(aws, queues):
    send(aws, queues, {"poison": True})
    seen = []

    def handler(event, context):
        seen.append(int(event["Records"][0]["attributes"]["ApproximateReceiveCount"]))
        return {"batchItemFailures": [{"itemIdentifier": event["Records"][0]["messageId"]}]}

    drain(aws.sqs, queues, handler)
    assert seen == [1, 2, 3]  # received three times, never a fourth
    assert dlq_depth(aws.sqs, queues) == 1
    assert json.loads(read_dlq(aws.sqs, queues)[0]["Body"]) == {"poison": True}


def test_a_message_that_succeeds_is_deleted_and_not_seen_again(aws, queues):
    send(aws, queues, {"ok": 1})
    calls = []
    result = poll_and_invoke(aws.sqs, queues, lambda e, c: calls.append(e) or {"batchItemFailures": []})
    assert result == {"received": 1, "deleted": 1, "failed": 0}
    assert poll_and_invoke(aws.sqs, queues, lambda e, c: None)["received"] == 0
    assert dlq_depth(aws.sqs, queues) == 0


def test_only_the_failed_message_of_a_batch_comes_back(aws, queues):
    for n in range(5):
        send(aws, queues, {"n": n})
    handled = []

    def handler(event, context):
        failures = []
        for record in event["Records"]:
            body = json.loads(record["body"])
            if body["n"] == 3:
                failures.append({"itemIdentifier": record["messageId"]})
            else:
                handled.append(body["n"])
        return {"batchItemFailures": failures}

    first = poll_and_invoke(aws.sqs, queues, handler)
    assert first == {"received": 5, "deleted": 4, "failed": 1}
    drain(aws.sqs, queues, handler)
    assert sorted(handled) == [0, 1, 2, 4]  # the four good ones were handled once each
    assert dlq_depth(aws.sqs, queues) == 1


def test_a_handler_that_raises_fails_the_whole_batch(aws, queues):
    for n in range(3):
        send(aws, queues, {"n": n})

    def handler(event, context):
        raise RuntimeError("the function crashed")

    assert poll_and_invoke(aws.sqs, queues, handler) == {"received": 3, "deleted": 0, "failed": 3}


def test_a_message_that_fails_twice_and_then_succeeds_is_not_dead_lettered(aws, queues):
    send(aws, queues, {"flaky": True})
    attempts = []

    def handler(event, context):
        record = event["Records"][0]
        attempts.append(record["attributes"]["ApproximateReceiveCount"])
        if len(attempts) < 3:
            return {"batchItemFailures": [{"itemIdentifier": record["messageId"]}]}
        return {"batchItemFailures": []}

    drain(aws.sqs, queues, handler)
    assert attempts == ["1", "2", "3"]
    assert dlq_depth(aws.sqs, queues) == 0


def test_reading_the_dead_letter_queue_does_not_remove_anything(aws, queues):
    send(aws, queues, "not json")
    drain(aws.sqs, queues, lambda e, c: {"batchItemFailures": [{"itemIdentifier": e["Records"][0]["messageId"]}]})
    assert len(read_dlq(aws.sqs, queues)) == 1
    assert len(read_dlq(aws.sqs, queues)) == 1
    assert dlq_depth(aws.sqs, queues) == 1


def test_redrive_sends_dead_letters_back_and_empties_the_dead_letter_queue(aws, queues):
    send(aws, queues, {"fixable": True})
    drain(aws.sqs, queues, lambda e, c: {"batchItemFailures": [{"itemIdentifier": e["Records"][0]["messageId"]}]})
    assert dlq_depth(aws.sqs, queues) == 1
    assert redrive_dlq(aws.sqs, queues) == 1
    assert dlq_depth(aws.sqs, queues) == 0
    ok = []
    drain(aws.sqs, queues, lambda e, c: ok.append(json.loads(e["Records"][0]["body"])) or {"batchItemFailures": []})
    assert ok == [{"fixable": True}]
