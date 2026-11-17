"""Strangler fig routing: a router in front of a legacy and a modern handler, moved one route at a time."""
import json

import pytest

from orders import routes, store
from orders.readmodel import StreamPoller, make_stream_handler
from orders.strangler import Rule, StranglerRouter, bucket

from helpers import order_body

LIST = "GET /customers/{customer_id}/orders"
ONE = "GET /orders/{order_id}"
KEYS = [f"cust-{n}" for n in range(2000)]


def event(method, path, query=None):
    """An API Gateway HTTP API (payload format 2.0) event."""
    return {"version": "2.0", "routeKey": "$default", "rawPath": path, "requestContext": {"http": {"method": method, "path": path}}, "queryStringParameters": query}


def stub(name, status=200):
    return lambda call: {"statusCode": status, "body": {"from": name, "path": call["path"]}}


def served_by(response):
    return response["headers"]["x-served-by"]


def router(rules, legacy=None, modern=None):
    return StranglerRouter(legacy or stub("legacy"), modern or stub("modern"), rules)


def test_a_route_not_in_the_table_goes_to_the_legacy_system():
    r = router({})
    assert served_by(r.handle(event("GET", "/anything"))) == "legacy"
    assert r.log == [("unmatched", "legacy")]


def test_a_listed_route_defaults_to_legacy_until_it_is_moved():
    assert served_by(router({LIST: Rule()}).handle(event("GET", "/customers/c1/orders"))) == "legacy"


def test_a_modern_route_goes_to_the_new_handler_and_the_response_is_proxy_shaped():
    response = router({LIST: Rule("modern")}).handle(event("GET", "/customers/c1/orders"))
    assert response["statusCode"] == 200 and served_by(response) == "modern"
    assert json.loads(response["body"]) == {"from": "modern", "path": "/customers/c1/orders"}


def test_the_method_is_part_of_the_route():
    r = router({LIST: Rule("modern")})
    assert served_by(r.handle(event("POST", "/customers/c1/orders"))) == "legacy"


def test_path_parameters_and_the_query_string_both_give_the_caller_key():
    r = router({LIST: Rule("allowlist", allow=frozenset({"vip"})), ONE: Rule("allowlist", allow=frozenset({"vip"}))})
    assert served_by(r.handle(event("GET", "/customers/vip/orders"))) == "modern"
    assert served_by(r.handle(event("GET", "/orders/o9", {"customer_id": "vip"}))) == "modern"
    assert served_by(r.handle(event("GET", "/orders/o9", {"customer_id": "someone"}))) == "legacy"
    assert served_by(r.handle(event("GET", "/orders/o9"))) == "legacy"


def test_an_allow_list_moves_only_the_listed_callers():
    r = router({LIST: Rule("allowlist", allow=frozenset({"a", "b"}))})
    sides = {k: served_by(r.handle(event("GET", f"/customers/{k}/orders"))) for k in ("a", "b", "c", "d")}
    assert sides == {"a": "modern", "b": "modern", "c": "legacy", "d": "legacy"}


def test_the_canary_share_is_close_to_the_percentage_and_stable_per_caller():
    r = router({LIST: Rule("canary", percent=25)})
    first = {k: served_by(r.handle(event("GET", f"/customers/{k}/orders"))) for k in KEYS}
    share = sum(1 for s in first.values() if s == "modern") / len(KEYS)
    assert 0.22 <= share <= 0.28
    again = {k: served_by(r.handle(event("GET", f"/customers/{k}/orders"))) for k in KEYS}
    assert first == again  # a customer never flips between systems


def test_the_canary_extremes_send_everyone_or_no_one():
    for percent, side in ((0, "legacy"), (100, "modern")):
        r = router({LIST: Rule("canary", percent=percent)})
        assert {served_by(r.handle(event("GET", f"/customers/{k}/orders"))) for k in KEYS[:300]} == {side}


def test_raising_the_percentage_never_moves_a_caller_back_to_legacy():
    sides = {}
    for percent in (0, 5, 10, 25, 50, 75, 100):
        r = router({LIST: Rule("canary", percent=percent)})
        sides[percent] = {k for k in KEYS[:500] if served_by(r.handle(event("GET", f"/customers/{k}/orders"))) == "modern"}
    ordered = [sides[p] for p in (0, 5, 10, 25, 50, 75, 100)]
    assert all(a <= b for a, b in zip(ordered, ordered[1:]))


def test_the_bucket_is_the_same_on_every_call_and_in_range():
    assert bucket("cust-1") == bucket("cust-1")
    assert all(0 <= bucket(k) < 100 for k in KEYS[:200])


def test_a_modern_failure_falls_back_to_legacy_when_the_flag_is_on():
    def broken(call):
        raise RuntimeError("new service down")

    r = router({LIST: Rule("modern", fallback=True)}, modern=broken)
    response = r.handle(event("GET", "/customers/c1/orders"))
    assert served_by(response) == "legacy" and response["statusCode"] == 200
    assert r.log == [(LIST, "legacy")]  # the log records who answered, not who was asked


def test_a_modern_5xx_also_falls_back_but_a_4xx_is_an_answer():
    r = router({LIST: Rule("modern")}, modern=stub("modern", 503))
    assert served_by(r.handle(event("GET", "/customers/c1/orders"))) == "legacy"
    r = router({LIST: Rule("modern")}, modern=stub("modern", 404))
    response = r.handle(event("GET", "/customers/c1/orders"))
    assert (served_by(response), response["statusCode"]) == ("modern", 404)


def test_with_fallback_off_a_modern_failure_is_not_hidden():
    def broken(call):
        raise RuntimeError("new service down")

    with pytest.raises(RuntimeError):
        router({LIST: Rule("modern", fallback=False)}, modern=broken).handle(event("GET", "/customers/c1/orders"))


@pytest.mark.parametrize("kwargs", [{"mode": "sideways"}, {"mode": "canary", "percent": 101}, {"mode": "canary", "percent": -1}])
def test_a_bad_rule_is_refused_when_it_is_written(kwargs):
    with pytest.raises(ValueError):
        Rule(**kwargs)


def test_a_cutover_moves_one_route_per_stage_and_touches_nothing_else():
    """Each stage of the plan changes exactly one route's table row; every other route answers as before."""
    plan = [
        {LIST: Rule(), ONE: Rule()},
        {LIST: Rule("canary", percent=10), ONE: Rule()},
        {LIST: Rule("canary", percent=50), ONE: Rule()},
        {LIST: Rule("modern"), ONE: Rule()},
        {LIST: Rule("modern"), ONE: Rule("allowlist", allow=frozenset(KEYS[:50]))},
        {LIST: Rule("modern"), ONE: Rule("modern")},
    ]
    probes = [event("GET", f"/customers/{k}/orders") for k in KEYS[:300]] + [event("GET", f"/orders/o1", {"customer_id": k}) for k in KEYS[:300]]

    def snapshot(rules):
        r = router(rules)
        return [(p["rawPath"], (p["queryStringParameters"] or {}).get("customer_id"), served_by(r.handle(p))) for p in probes]

    previous = snapshot(plan[0])
    for before, after in zip(plan, plan[1:]):
        changed = [route for route in before if before[route] != after[route]]
        assert len(changed) == 1  # the plan itself moves one route at a time
        current = snapshot(after)
        for was, now in zip(previous, current):
            is_changed_route = (LIST in changed) == was[0].startswith("/customers")
            if not is_changed_route:
                assert was == now  # the other route did not move
        previous = current


# ---- parity: a route may move only while both systems give the same answer ----

@pytest.fixture
def both(tables):
    ddb = tables.ddb
    rows = [("o1", "c1", [{"sku": "a", "qty": 2, "price_cents": 500}]), ("o2", "c1", [{"sku": "b", "qty": 1, "price_cents": 250}]), ("o3", "c2", [{"sku": "a", "qty": 1, "price_cents": 500}])]
    legacy_db = {}
    for oid, cid, lines in rows:
        order = store.place_order(ddb, store.parse_order(order_body(oid, cid, lines)))
        store.transition(ddb, oid, store.CANCELLED if oid == "o2" else store.RESERVED, 1)
        legacy_db[(cid, oid)] = {"order_id": oid, "status": "CANCELLED" if oid == "o2" else "RESERVED", "total_cents": order.total_cents}
    StreamPoller(tables.streams, tables.stream_arn, make_stream_handler(ddb)).poll()
    return routes.legacy_app(legacy_db), routes.modern_app(ddb)


CALLS = [
    {"method": "GET", "path": "/customers/c1/orders", "params": {"customer_id": "c1"}, "query": {}, "body": None},
    {"method": "GET", "path": "/customers/c2/orders", "params": {"customer_id": "c2"}, "query": {}, "body": None},
    {"method": "GET", "path": "/customers/nobody/orders", "params": {"customer_id": "nobody"}, "query": {}, "body": None},
    {"method": "GET", "path": "/orders/o1", "params": {"order_id": "o1"}, "query": {"customer_id": "c1"}, "body": None},
    {"method": "GET", "path": "/orders/o2", "params": {"order_id": "o2"}, "query": {"customer_id": "c1"}, "body": None},
    {"method": "GET", "path": "/orders/o1", "params": {"order_id": "o1"}, "query": {"customer_id": "c2"}, "body": None},  # wrong owner
    {"method": "GET", "path": "/orders/ghost", "params": {"order_id": "ghost"}, "query": {"customer_id": "c1"}, "body": None},
    {"method": "GET", "path": "/orders/o1", "params": {"order_id": "o1"}, "query": {}, "body": None},  # no customer id
]


@pytest.mark.parametrize("call", CALLS, ids=[f"{c['path']}?{c['query']}" for c in CALLS])
def test_the_modern_handler_answers_exactly_like_the_legacy_one(both, call):
    legacy, modern = both
    assert modern(call) == legacy(call)


def test_the_parity_data_is_not_trivially_empty(both):
    legacy, _ = both
    assert set(routes.ROUTES) == {LIST, ONE}
    assert len(legacy(CALLS[0])["body"]["orders"]) == 2 and legacy(CALLS[2])["body"] == {"orders": []}
    assert legacy(CALLS[6])["statusCode"] == 404 and legacy(CALLS[7])["statusCode"] == 400


def test_moving_a_route_to_modern_does_not_change_what_the_caller_sees(both):
    legacy, modern = both
    before = router({LIST: Rule(), ONE: Rule()}, legacy, modern)
    after = router({LIST: Rule("modern"), ONE: Rule()}, legacy, modern)
    request = event("GET", "/customers/c1/orders")
    a, b = before.handle(request), after.handle(request)
    assert (served_by(a), served_by(b)) == ("legacy", "modern")
    assert (a["statusCode"], a["body"]) == (b["statusCode"], b["body"])
