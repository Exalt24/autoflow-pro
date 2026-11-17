"""The order saga end to end: the ASL definition run by the local runner, its task functions writing to moto's DynamoDB."""
import pytest

from orders import store
from orders.standins import PaymentDeclined, TransientError

from helpers import order_body


def start(world, **kw):
    order = store.place_order(world.ddb, store.parse_order(order_body(**kw)))
    return order, world.run_saga({"order_id": order.order_id, "customer_id": order.customer_id, "total_cents": order.total_cents})


def test_the_happy_path_reserves_charges_ships_and_confirms(world):
    store.seed_stock(world.ddb, "widget", 10)
    order, result = start(world)
    assert result.status == "SUCCEEDED"
    assert result.path == ["ReserveInventory", "NeedsPayment", "ChargePayment", "CreateShipment", "ConfirmOrder", "OrderConfirmed"]
    assert store.get_order(world.ddb, "o1").status == store.CONFIRMED
    assert store.stock_of(world.ddb, "widget") == 8
    assert world.payments.charges == {"order-o1": 1000} and "order-o1" in world.carrier.shipments


def test_a_declined_card_refunds_nothing_releases_the_stock_and_cancels(world):
    store.seed_stock(world.ddb, "widget", 10)
    world.payments.declined_customers.add("c1")
    _, result = start(world)
    assert (result.status, result.error) == ("FAILED", "OrderCancelled")
    assert result.path == ["ReserveInventory", "NeedsPayment", "ChargePayment", "RefundPayment", "ReleaseInventory", "CancelOrder", "OrderCancelled"]
    assert store.get_order(world.ddb, "o1").status == store.CANCELLED
    assert store.stock_of(world.ddb, "widget") == 10  # the reservation was given back
    assert world.payments.charges == {} and store.get_payment(world.ddb, "o1") is None


def test_a_carrier_rejection_after_payment_refunds_and_releases(world):
    store.seed_stock(world.ddb, "widget", 10)
    world.carrier.reject_next = True
    _, result = start(world)
    assert result.error == "OrderCancelled"
    assert result.path[3:] == ["CreateShipment", "CancelShipment", "RefundPayment", "ReleaseInventory", "CancelOrder", "OrderCancelled"]
    assert "order-o1" in world.payments.refunds  # the charge was reversed
    assert store.stock_of(world.ddb, "widget") == 10
    assert store.get_order(world.ddb, "o1").status == store.CANCELLED


def test_no_stock_cancels_without_charging_anyone(world):
    store.seed_stock(world.ddb, "widget", 1)
    _, result = start(world)
    assert result.error == "OrderCancelled"
    assert world.payments.calls == 0
    assert store.stock_of(world.ddb, "widget") == 1
    assert store.get_order(world.ddb, "o1").status == store.CANCELLED


def test_transient_payment_failures_are_retried_with_backoff_and_charge_once(world):
    store.seed_stock(world.ddb, "widget", 10)
    world.payments.fail_next = 2
    _, result = start(world)
    assert result.status == "SUCCEEDED"
    assert world.delays == [1, 2]
    assert result.retries == [("ChargePayment", 1, 1), ("ChargePayment", 2, 2)]
    assert world.payments.charges == {"order-o1": 1000}


def test_a_payment_provider_that_stays_down_ends_in_a_full_compensation(world):
    store.seed_stock(world.ddb, "widget", 10)
    world.payments.fail_next = 99
    _, result = start(world)
    assert result.error == "OrderCancelled"
    assert world.payments.calls == 4  # one call and three retries
    assert store.stock_of(world.ddb, "widget") == 10


def test_a_free_order_skips_the_payment_and_is_still_confirmed(world):
    store.seed_stock(world.ddb, "gift", 3)
    order, result = start(world, lines=[{"sku": "gift", "qty": 1, "price_cents": 0}])
    assert result.status == "SUCCEEDED" and "ChargePayment" not in result.path
    assert world.payments.calls == 0
    assert store.get_order(world.ddb, "o1").status == store.CONFIRMED


def test_a_charge_that_timed_out_after_it_went_through_is_still_refunded(world):
    store.seed_stock(world.ddb, "widget", 10)
    real = world.tasks[next(k for k in world.tasks if k.endswith("charge-payment"))]

    def charge_then_lose_the_answer(state):
        real(state)
        raise ConnectionError("the response never arrived")

    world.tasks[next(k for k in world.tasks if k.endswith("charge-payment"))] = charge_then_lose_the_answer
    _, result = start(world)
    assert result.error == "OrderCancelled"
    assert world.payments.refunds == {"order-o1"}  # refunded by order id, not by what the state remembered


def test_a_failure_after_the_shipment_cancels_the_shipment_and_refunds(world):
    store.seed_stock(world.ddb, "widget", 10)
    key = next(k for k in world.tasks if k.endswith("confirm-order"))

    def broken(state):
        raise RuntimeError("confirmation failed")

    world.tasks[key] = broken
    _, result = start(world)
    assert result.error == "OrderCancelled"
    assert "order-o1" in world.carrier.cancelled and "order-o1" in world.payments.refunds
    assert store.stock_of(world.ddb, "widget") == 10
    assert store.get_order(world.ddb, "o1").status == store.CANCELLED


def test_running_the_saga_twice_for_one_order_changes_nothing_the_second_time(world):
    store.seed_stock(world.ddb, "widget", 10)
    order, first = start(world)
    again = world.run_saga({"order_id": "o1", "customer_id": "c1", "total_cents": order.total_cents})
    assert first.status == again.status == "SUCCEEDED"
    assert store.stock_of(world.ddb, "widget") == 8
    assert world.payments.charges == {"order-o1": 1000}


def test_the_compensations_can_run_twice(world):
    store.seed_stock(world.ddb, "widget", 10)
    world.payments.declined_customers.add("c1")
    order, _ = start(world)
    again = world.run_saga({"order_id": "o1", "customer_id": "c1", "total_cents": order.total_cents})
    assert again.error == "OrderCancelled"
    assert store.stock_of(world.ddb, "widget") == 10


def test_the_two_stand_ins_charge_and_ship_once_per_key():
    from orders.standins import FakeCarrier, FakePaymentProvider

    payments, carrier = FakePaymentProvider(), FakeCarrier()
    payments.charge("k", "c", 100)
    payments.charge("k", "c", 100)
    assert payments.charges == {"k": 100}
    assert carrier.ship("k") == carrier.ship("k")
    assert payments.refund("k") and not payments.refund("k") and not payments.refund("nope")
    assert carrier.cancel("k") and not carrier.cancel("k")
    payments.declined_customers.add("bad")
    with pytest.raises(PaymentDeclined):
        payments.charge("k2", "bad", 1)
    payments.fail_next = 1
    with pytest.raises(TransientError):
        payments.charge("k3", "c", 1)
