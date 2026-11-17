"""DynamoDB single table: conditional writes, optimistic locking, stock, against moto."""
import pytest

from orders import store
from orders.store import (
    CANCELLED, CONFIRMED, PAID, PENDING, RESERVED, SHIPPED,
    DuplicateOrder, IllegalTransition, InvalidOrder, OrderNotFound, OutOfStock, VersionConflict,
)

from helpers import order_body


def place(ddb, **kw):
    return store.place_order(ddb, store.parse_order(order_body(**kw)))


def test_parse_order_totals_the_lines():
    order = store.parse_order(order_body(lines=[{"sku": "a", "qty": 2, "price_cents": 300}, {"sku": "b", "qty": 1, "price_cents": 50}]))
    assert order.total_cents == 650 and order.status == PENDING and order.version == 1


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        {},
        {"order_id": "o", "customer_id": "c"},
        {"order_id": "", "customer_id": "c", "lines": [{"sku": "a", "qty": 1, "price_cents": 1}]},
        {"order_id": "o", "customer_id": "c", "lines": []},
        {"order_id": "o", "customer_id": "c", "lines": [{"sku": "a", "qty": 0, "price_cents": 1}]},
        {"order_id": "o", "customer_id": "c", "lines": [{"sku": "a", "qty": "two", "price_cents": 1}]},
        {"order_id": "o", "customer_id": "c", "lines": [{"sku": "a", "qty": 1, "price_cents": -5}]},
        {"order_id": "o", "customer_id": "c", "lines": [{"sku": "a", "qty": 1, "price_cents": 1}, {"sku": "a", "qty": 1, "price_cents": 1}]},
    ],
)
def test_parse_order_rejects_a_malformed_body(body):
    with pytest.raises(InvalidOrder):
        store.parse_order(body)


def test_placing_an_order_writes_the_header_and_every_line(tables):
    place(tables.ddb, lines=[{"sku": "a", "qty": 1, "price_cents": 100}, {"sku": "b", "qty": 3, "price_cents": 20}])
    got = store.get_order(tables.ddb, "o1")
    assert [(l.sku, l.qty) for l in got.lines] == [("a", 1), ("b", 3)]
    assert got.total_cents == 160 and got.version == 1


def test_the_same_order_id_cannot_be_created_twice_and_the_first_one_is_kept(tables):
    place(tables.ddb, lines=[{"sku": "a", "qty": 1, "price_cents": 100}])
    with pytest.raises(DuplicateOrder):
        place(tables.ddb, lines=[{"sku": "z", "qty": 9, "price_cents": 999}])
    assert [l.sku for l in store.get_order(tables.ddb, "o1").lines] == ["a"]


def test_a_missing_order_raises_not_found(tables):
    with pytest.raises(OrderNotFound):
        store.get_order(tables.ddb, "nope")


def test_a_transition_bumps_the_version(tables):
    place(tables.ddb)
    assert store.transition(tables.ddb, "o1", RESERVED, expected_version=1) == 2
    assert store.get_order(tables.ddb, "o1").status == RESERVED


def test_a_stale_version_is_refused_and_changes_nothing(tables):
    place(tables.ddb)
    store.transition(tables.ddb, "o1", RESERVED, expected_version=1)
    with pytest.raises(VersionConflict):
        store.transition(tables.ddb, "o1", PAID, expected_version=1)  # a writer holding the old read
    current = store.get_order(tables.ddb, "o1")
    assert (current.status, current.version) == (RESERVED, 2)


def test_two_writers_with_the_same_read_only_one_wins(tables):
    place(tables.ddb)
    store.transition(tables.ddb, "o1", RESERVED, expected_version=1)
    store.transition(tables.ddb, "o1", PAID, expected_version=2)
    with pytest.raises(VersionConflict):
        store.transition(tables.ddb, "o1", CANCELLED, expected_version=2)
    assert store.get_order(tables.ddb, "o1").status == PAID


@pytest.mark.parametrize("to_status", [PAID, CONFIRMED])
def test_an_illegal_jump_is_refused_even_with_the_right_version(tables, to_status):
    place(tables.ddb)
    with pytest.raises(IllegalTransition):
        store.transition(tables.ddb, "o1", to_status, expected_version=1)


def test_pending_cannot_ship_and_a_cancelled_order_cannot_come_back(tables):
    place(tables.ddb)
    with pytest.raises(IllegalTransition):
        store.transition(tables.ddb, "o1", SHIPPED, expected_version=1)
    store.transition(tables.ddb, "o1", CANCELLED, expected_version=1)
    with pytest.raises(IllegalTransition):
        store.transition(tables.ddb, "o1", RESERVED, expected_version=2)


def test_a_transition_on_a_missing_order_raises_not_found(tables):
    with pytest.raises(OrderNotFound):
        store.transition(tables.ddb, "ghost", RESERVED, expected_version=1)


class RacingWriter:
    """Wraps the client and, once, lets another writer change the order between our read and our write."""

    def __init__(self, ddb, order_id):
        self.ddb, self.order_id, self.raced = ddb, order_id, False

    def __getattr__(self, name):
        return getattr(self.ddb, name)

    def update_item(self, **kwargs):
        if not self.raced:
            self.raced = True
            current = store.get_order(self.ddb, self.order_id)
            store.transition(self.ddb, self.order_id, CANCELLED, current.version)
        return self.ddb.update_item(**kwargs)


def test_move_to_rereads_and_gives_up_cleanly_when_another_writer_wins(tables):
    place(tables.ddb)
    racing = RacingWriter(tables.ddb, "o1")
    # the other writer cancels the order mid-flight: our reserve must not be applied on top of it
    with pytest.raises(IllegalTransition):
        store.move_to(racing, "o1", RESERVED)
    assert store.get_order(tables.ddb, "o1").status == CANCELLED


def test_move_to_retries_after_a_lost_race_that_leaves_the_move_legal(tables):
    place(tables.ddb)
    store.transition(tables.ddb, "o1", RESERVED, expected_version=1)

    class BumpOnce(RacingWriter):
        def update_item(self, **kwargs):
            if not self.raced:
                self.raced = True
                # a harmless concurrent write that bumps the version but keeps the status
                self.ddb.update_item(
                    TableName=store.TABLE, Key={"PK": "ORDER#o1", "SK": "META"},
                    UpdateExpression="SET #v = #v + :one", ExpressionAttributeNames={"#v": "version"}, ExpressionAttributeValues={":one": 1},
                )
            return self.ddb.update_item(**kwargs)

    result = store.move_to(BumpOnce(tables.ddb, "o1"), "o1", PAID)
    assert result.status == PAID and result.version == 4  # 2, bumped to 3 by the other writer, then 4 by us


def test_move_to_is_a_no_op_when_already_there_or_further_along(tables):
    place(tables.ddb)
    store.move_to(tables.ddb, "o1", RESERVED)
    store.move_to(tables.ddb, "o1", PAID)
    again = store.move_to(tables.ddb, "o1", RESERVED)  # a retried earlier step
    assert (again.status, again.version) == (PAID, 3)


def test_move_to_gives_up_after_the_attempt_limit(tables):
    place(tables.ddb)

    class AlwaysLosing(RacingWriter):
        def update_item(self, **kwargs):
            self.ddb.update_item(
                TableName=store.TABLE, Key={"PK": "ORDER#o1", "SK": "META"},
                UpdateExpression="SET #v = #v + :one", ExpressionAttributeNames={"#v": "version"}, ExpressionAttributeValues={":one": 1},
            )
            return self.ddb.update_item(**kwargs)

    with pytest.raises(VersionConflict):
        store.move_to(AlwaysLosing(tables.ddb, "o1"), "o1", RESERVED, attempts=3)


def test_reserving_stock_takes_it_and_records_the_reservation(tables):
    store.seed_stock(tables.ddb, "widget", 10)
    order = place(tables.ddb)
    store.reserve_stock(tables.ddb, order)
    assert store.stock_of(tables.ddb, "widget") == 8


def test_reserving_more_than_is_available_fails_and_changes_nothing(tables):
    store.seed_stock(tables.ddb, "widget", 1)
    order = place(tables.ddb)
    with pytest.raises(OutOfStock):
        store.reserve_stock(tables.ddb, order)
    assert store.stock_of(tables.ddb, "widget") == 1


def test_a_multi_line_reservation_is_all_or_nothing(tables):
    store.seed_stock(tables.ddb, "a", 5)
    store.seed_stock(tables.ddb, "b", 0)
    order = place(tables.ddb, lines=[{"sku": "a", "qty": 2, "price_cents": 1}, {"sku": "b", "qty": 1, "price_cents": 1}])
    with pytest.raises(OutOfStock):
        store.reserve_stock(tables.ddb, order)
    assert store.stock_of(tables.ddb, "a") == 5  # line a was not kept when line b failed


def test_reserving_twice_for_the_same_order_takes_the_stock_once(tables):
    store.seed_stock(tables.ddb, "widget", 10)
    order = place(tables.ddb)
    store.reserve_stock(tables.ddb, order)
    store.reserve_stock(tables.ddb, order)
    assert store.stock_of(tables.ddb, "widget") == 8


def test_releasing_gives_the_stock_back_once_however_often_it_runs(tables):
    store.seed_stock(tables.ddb, "widget", 10)
    order = place(tables.ddb)
    store.reserve_stock(tables.ddb, order)
    assert store.release_stock(tables.ddb, order) == 2
    assert store.release_stock(tables.ddb, order) == 0
    assert store.stock_of(tables.ddb, "widget") == 10


def test_two_releases_that_read_the_reservation_at_the_same_time_give_the_stock_back_once(tables):
    store.seed_stock(tables.ddb, "widget", 10)
    order = place(tables.ddb)
    store.reserve_stock(tables.ddb, order)

    class StaleReads:
        """The second release read the reservation before the first one deleted it."""

        def __init__(self, ddb):
            self.ddb, self.seen = ddb, None

        def __getattr__(self, name):
            return getattr(self.ddb, name)

        def get_item(self, **kwargs):
            if kwargs["Key"]["SK"].startswith("RESERVATION#"):
                if self.seen is None:
                    self.seen = self.ddb.get_item(**kwargs)
                return self.seen
            return self.ddb.get_item(**kwargs)

    racing = StaleReads(tables.ddb)
    assert store.release_stock(racing, order) == 2
    assert store.release_stock(racing, order) == 0  # its read is stale, the delete's condition refuses it
    assert store.stock_of(tables.ddb, "widget") == 10


def test_releasing_an_order_that_never_reserved_changes_nothing(tables):
    store.seed_stock(tables.ddb, "widget", 10)
    order = place(tables.ddb)
    assert store.release_stock(tables.ddb, order) == 0
    assert store.stock_of(tables.ddb, "widget") == 10


def test_the_last_unit_goes_to_one_of_two_orders(tables):
    store.seed_stock(tables.ddb, "widget", 2)
    first = place(tables.ddb, order_id="o1")
    second = place(tables.ddb, order_id="o2")
    store.reserve_stock(tables.ddb, first)
    with pytest.raises(OutOfStock):
        store.reserve_stock(tables.ddb, second)
    assert store.stock_of(tables.ddb, "widget") == 0
