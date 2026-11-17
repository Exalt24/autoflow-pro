"""The ASL validator and runner, and a seeded property test of the saga's compensation rule."""
import copy
import random

import pytest

from orders.saga import asl, steps


@pytest.fixture
def saga():
    return steps.load_saga()


def test_the_shipped_definition_has_no_problems(saga):
    assert asl.validate_definition(saga) == []
    assert asl.compensation_gaps(saga) == []


def mutated(saga, fn):
    d = copy.deepcopy(saga)
    fn(d["States"])
    return d


@pytest.mark.parametrize(
    "change, expected",
    [
        (lambda s: s["ReserveInventory"].update(Next="Nowhere"), "not a state"),
        (lambda s: s["ReserveInventory"].pop("Next"), "exactly one of Next and End"),
        (lambda s: s["ReserveInventory"].update(End=True), "exactly one of Next and End"),
        (lambda s: s["ChargePayment"].pop("Resource"), "needs a Resource"),
        (lambda s: s["ChargePayment"].update(Type="Mystery"), "unsupported Type"),
        (lambda s: s["OrderConfirmed"].update(Next="CancelOrder"), "no Next or End"),
        (lambda s: s["ChargePayment"].update(Parameters={"a": 1}), "not supported"),
        (lambda s: s["ReserveInventory"]["Retry"][0].update(BackoffRate=0.5), "BackoffRate"),
        (lambda s: s["ReserveInventory"]["Retry"][0].update(MaxAttempts=-1), "MaxAttempts"),
        (lambda s: s["ReserveInventory"]["Retry"][0].update(IntervalSeconds=0), "IntervalSeconds"),
        (lambda s: s["ReserveInventory"]["Retry"][0].update(ErrorEquals=[]), "needs ErrorEquals"),
        (lambda s: s["ReserveInventory"]["Retry"].append({"ErrorEquals": ["States.ALL"]}) or s["ReserveInventory"]["Retry"].insert(0, {"ErrorEquals": ["States.ALL"]}), "States.ALL must be alone and in the last"),
        (lambda s: s["ReserveInventory"]["Catch"][0].pop("Next"), "needs Next"),
        (lambda s: s.update(Orphan={"Type": "Succeed"}), "not reachable"),
        (lambda s: s["CancelOrder"].update(Next="CancelOrder"), "no path from here ends"),
        (lambda s: s["NeedsPayment"].update(Choices=[]), "needs Choices"),
    ],
)
def test_the_validator_names_each_kind_of_broken_definition(saga, change, expected):
    problems = asl.validate_definition(mutated(saga, change))
    assert any(expected in p for p in problems), problems


def test_a_definition_with_no_states_or_a_bad_start_is_refused(saga):
    assert asl.validate_definition({"StartAt": "A", "States": {}})
    bad = copy.deepcopy(saga)
    bad["StartAt"] = "Missing"
    assert any("StartAt" in p for p in asl.validate_definition(bad))


def test_the_runner_refuses_an_invalid_definition(saga):
    bad = mutated(saga, lambda s: s["ReserveInventory"].update(Next="Nowhere"))
    with pytest.raises(asl.DefinitionError):
        asl.run(bad, {}, {})


def test_the_compensation_check_finds_a_catch_path_that_skips_a_compensation(saga):
    gaps = asl.compensation_gaps(mutated(saga, lambda s: s["ConfirmOrder"]["Catch"][0].update(Next="RefundPayment")))
    assert gaps == ["ConfirmOrder: failing here does not run CancelShipment"]


def test_the_compensation_check_wants_a_steps_own_undo_too(saga):
    gaps = asl.compensation_gaps(mutated(saga, lambda s: s["CreateShipment"]["Catch"][0].update(Next="RefundPayment")))
    assert gaps == ["CreateShipment: failing here does not run CancelShipment"]


def test_the_compensation_check_finds_a_missing_catch_and_a_missing_compensation(saga):
    assert any("no Catch" in g for g in asl.compensation_gaps(mutated(saga, lambda s: s["ConfirmOrder"].pop("Catch"))))
    comment = lambda s: s["RefundPayment"].update(Comment="ends the saga")
    assert any("ChargePayment: no compensation" in g for g in asl.compensation_gaps(mutated(saga, comment)))


# ---- the runner on small definitions ----

TWO = {
    "StartAt": "A",
    "States": {
        "A": {"Type": "Task", "Resource": "a", "ResultPath": "$.a", "Next": "Pick"},
        "Pick": {"Type": "Choice", "Choices": [{"Variable": "$.a.n", "NumericGreaterThan": 5, "Next": "Big"}, {"Variable": "$.a.n", "NumericEquals": 5, "Next": "Five"}], "Default": "Small"},
        "Big": {"Type": "Pass", "Result": "big", "ResultPath": "$.size", "End": True},
        "Five": {"Type": "Pass", "Result": "five", "ResultPath": "$.size", "End": True},
        "Small": {"Type": "Pass", "Result": "small", "ResultPath": "$.size", "End": True},
    },
}


@pytest.mark.parametrize("n, size", [(9, "big"), (5, "five"), (1, "small")])
def test_a_choice_takes_the_first_matching_branch_or_the_default(n, size):
    result = asl.run(TWO, {"a": lambda s: {"n": n}}, {})
    assert result.status == "SUCCEEDED" and result.output["size"] == size


def test_a_choice_with_no_match_and_no_default_fails_the_execution():
    no_default = copy.deepcopy(TWO)
    del no_default["States"]["Pick"]["Default"]
    del no_default["States"]["Small"]
    result = asl.run(no_default, {"a": lambda s: {"n": 1}}, {})
    assert (result.status, result.error) == ("FAILED", "States.NoChoiceMatched")


class Flaky(Exception):
    pass


class Other(Exception):
    pass


RETRY = {
    "StartAt": "T",
    "States": {
        "T": {
            "Type": "Task", "Resource": "t", "End": True,
            "Retry": [{"ErrorEquals": ["Flaky"], "IntervalSeconds": 2, "MaxAttempts": 3, "BackoffRate": 2.0}],
            "Catch": [{"ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "Failed"}],
        },
        "Failed": {"Type": "Fail", "Error": "Gave", "Cause": "up"},
    },
}


def failing(times, error=Flaky):
    calls = {"n": 0}

    def fn(state):
        calls["n"] += 1
        if calls["n"] <= times:
            raise error("boom")
        return {"ok": True}

    fn.calls = calls
    return fn


def test_retry_waits_with_exponential_backoff_and_then_succeeds():
    delays = []
    fn = failing(2)
    result = asl.run(RETRY, {"t": fn}, {}, sleep=delays.append)
    assert result.status == "SUCCEEDED" and fn.calls["n"] == 3
    assert delays == [2, 4]
    assert result.retries == [("T", 1, 2), ("T", 2, 4)]


def test_retry_stops_at_max_attempts_and_falls_through_to_catch():
    fn = failing(99)
    delays = []
    result = asl.run(RETRY, {"t": fn}, {}, sleep=delays.append)
    assert fn.calls["n"] == 4  # the first call and three retries
    assert delays == [2, 4, 8]
    assert (result.status, result.error) == ("FAILED", "Gave")
    assert result.output["error"] == {"Error": "Flaky", "Cause": "boom"}


def test_an_error_no_retry_rule_names_goes_straight_to_catch():
    fn = failing(99, error=Other)
    delays = []
    result = asl.run(RETRY, {"t": fn}, {}, sleep=delays.append)
    assert fn.calls["n"] == 1 and delays == []
    assert result.error == "Gave"


def test_an_uncaught_error_fails_the_execution_with_its_name():
    no_catch = copy.deepcopy(RETRY)
    del no_catch["States"]["T"]["Catch"]
    del no_catch["States"]["Failed"]
    no_catch["States"]["T"]["End"] = True
    result = asl.run(no_catch, {"t": failing(99, error=Other)}, {})
    assert (result.status, result.error, result.cause) == ("FAILED", "Other", "boom")


def test_a_task_with_no_function_wired_is_a_definition_error():
    with pytest.raises(asl.DefinitionError):
        asl.run(RETRY, {}, {})


def test_the_runner_does_not_change_the_callers_payload():
    payload = {"x": {"y": 1}}
    asl.run(TWO, {"a": lambda s: s["x"].update(y=2) or {"n": 1}}, payload)
    assert payload == {"x": {"y": 1}}


def test_a_loop_is_cut_off_instead_of_running_forever():
    loop = {"StartAt": "P", "States": {"P": {"Type": "Pass", "Next": "Q"}, "Q": {"Type": "Choice", "Choices": [{"Variable": "$.go", "BooleanEquals": True, "Next": "P"}], "Default": "Done"}, "Done": {"Type": "Succeed"}}}
    with pytest.raises(asl.DefinitionError):
        asl.run(loop, {}, {"go": True}, max_steps=50)


# ---- property test: the saga's rule over many seeded random worlds ----

FORWARD = ["reserve-inventory", "charge-payment", "create-shipment", "confirm-order"]
COMPENSATIONS = ["cancel-shipment", "refund-payment", "release-inventory", "cancel-order"]


def world_tasks(rng, total_cents):
    """Pure Python task functions over a ledger. Each forward step may fail permanently, fail transiently N times,
    or succeed and then fail (a timeout after the work was done). Compensations fail transiently too and are idempotent."""
    ledger = {"stock": 5, "charged": 0, "shipped": False, "status": "PENDING", "reserved": False}
    plan = {}
    for name in FORWARD + COMPENSATIONS:
        kind = rng.choice(["ok", "ok", "ok", "transient", "permanent", "late"] if name in FORWARD else ["ok", "ok", "transient"])
        plan[name] = (kind, rng.randint(1, 4))
    seen = {name: 0 for name in plan}

    def make(name, effect):
        def fn(state):
            seen[name] += 1
            kind, n = plan[name]
            if kind == "transient" and seen[name] <= n:
                raise Flaky("transient")
            if kind == "permanent":
                raise Other("permanent")
            effect()
            if kind == "late" and seen[name] == 1:
                raise Other("answered after the work was done")
            return {}
        fn.__name__ = name
        return fn

    def reserve():
        if not ledger["reserved"]:
            ledger["stock"] -= 1
            ledger["reserved"] = True

    def charge():
        ledger["charged"] = total_cents

    def ship():
        ledger["shipped"] = True

    def confirm():
        ledger["status"] = "CONFIRMED"

    def cancel_ship():
        ledger["shipped"] = False

    def refund():
        ledger["charged"] = 0

    def release():
        if ledger["reserved"]:
            ledger["stock"] += 1
            ledger["reserved"] = False

    def cancel():
        ledger["status"] = "CANCELLED"

    effects = [reserve, charge, ship, confirm, cancel_ship, refund, release, cancel]
    arn = steps.ACCOUNT_REGION
    return {arn + name: make(name, effect) for name, effect in zip(FORWARD + COMPENSATIONS, effects)}, ledger


@pytest.mark.parametrize("seed", range(300))
def test_whatever_fails_the_saga_ends_confirmed_or_fully_compensated(seed, saga):
    rng = random.Random(seed)
    total = rng.choice([0, 0, 1000, 2500])
    tasks, ledger = world_tasks(rng, total)
    result = asl.run(saga, tasks, {"order_id": "o", "customer_id": "c", "total_cents": total})
    if result.status == "SUCCEEDED":
        assert ledger == {"stock": 4, "charged": total, "shipped": True, "status": "CONFIRMED", "reserved": True}
    elif result.error == "OrderCancelled":
        # every effect that happened was undone, and the order says so
        assert ledger == {"stock": 5, "charged": 0, "shipped": False, "status": "CANCELLED", "reserved": False}
    else:
        pytest.fail(f"seed {seed}: stopped with {result.error} at {result.path[-1]}")
    if total == 0:
        assert "ChargePayment" not in result.path  # a free order skips the payment step

