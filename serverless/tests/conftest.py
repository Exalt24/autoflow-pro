import os
import sys
from types import SimpleNamespace

import boto3
import pytest
from botocore.config import Config
from moto import mock_aws

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from orders import readmodel, store  # noqa: E402
from orders.messaging import create_order_queues  # noqa: E402
from orders.saga import asl, steps  # noqa: E402
from orders.standins import FakeCarrier, FakePaymentProvider  # noqa: E402

REGION = "ap-southeast-2"


@pytest.fixture
def aws(monkeypatch):
    """Every AWS call in a test goes to moto, in this process. No credentials and no network are used."""
    for key, value in {"AWS_ACCESS_KEY_ID": "testing", "AWS_SECRET_ACCESS_KEY": "testing", "AWS_DEFAULT_REGION": REGION}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        yield SimpleNamespace(
            sqs=boto3.client("sqs"),
            sns=boto3.client("sns"),
            events=boto3.client("events"),
            ddb=boto3.resource("dynamodb").meta.client,
            # moto only routes the regional DynamoDB Streams endpoint, not the account id one the SDK prefers
            streams=boto3.client("dynamodbstreams", config=Config(account_id_endpoint_mode="disabled")),
        )


@pytest.fixture
def tables(aws):
    store.create_table(aws.ddb)
    readmodel.create_view_table(aws.ddb)
    aws.stream_arn = aws.ddb.describe_table(TableName=store.TABLE)["Table"]["LatestStreamArn"]
    return aws


@pytest.fixture
def queues(aws):
    return create_order_queues(aws.sqs, "orders", max_receive_count=3, visibility_timeout=0)


@pytest.fixture
def world(tables):
    """Tables, a payment stand-in, a carrier stand-in and the saga task functions wired to them."""
    tables.payments = FakePaymentProvider()
    tables.carrier = FakeCarrier()
    tables.tasks = steps.build_tasks(tables.ddb, tables.payments, tables.carrier)
    tables.definition = steps.load_saga()
    tables.delays = []

    def run_saga(payload):
        return asl.run(tables.definition, tables.tasks, payload, sleep=tables.delays.append)

    tables.run_saga = run_saga
    return tables

