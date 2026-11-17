"""The Bedrock client against stand-ins only: botocore's Stubber (which checks every request and every reply against
the real service model) and a hand written fake. No Bedrock endpoint is ever called."""
import boto3
import pytest
from botocore.stub import Stubber

from orders import triage
from orders.bedrock import (
    BedrockClient, BedrockError, InvalidRequest, ModelAccessError, ModelFailed, ModelNotFound, RetriesExhausted,
)

MODEL = "example.model-v1:0"


def make_clients():
    kw = dict(region_name="ap-southeast-2", aws_access_key_id="testing", aws_secret_access_key="testing")
    return boto3.client("bedrock-runtime", **kw), boto3.client("bedrock", **kw)


@pytest.fixture
def clients():
    runtime, control = make_clients()
    with Stubber(runtime) as rt, Stubber(control) as ct:
        yield runtime, control, rt, ct


def reply(text="hello", stop="end_turn", tokens=(7, 3)):
    return {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "stopReason": stop,
        "usage": {"inputTokens": tokens[0], "outputTokens": tokens[1], "totalTokens": sum(tokens)},
        "metrics": {"latencyMs": 120},
    }


def client(runtime, control=None, sleeps=None, attempts=4):
    return BedrockClient(runtime, MODEL, control, max_attempts=attempts, base_delay=1.0, sleep=(sleeps.append if sleeps is not None else (lambda s: None)), jitter=lambda: 1.0)


def expected(prompt="hi", system=None, max_tokens=512, temperature=0.0):
    params = {"modelId": MODEL, "messages": [{"role": "user", "content": [{"text": prompt}]}], "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature}}
    if system:
        params["system"] = [{"text": system}]
    return params


def error(stubber, code, message="x", status=400):
    stubber.add_client_error("converse", service_error_code=code, service_message=message, http_status_code=status)


def test_a_converse_call_is_sent_in_the_documented_shape_and_the_reply_is_parsed(clients):
    runtime, _, rt, _ = clients
    rt.add_response("converse", reply("two sentences.", tokens=(11, 5)), expected("hi", "be brief", 99, 0.2))
    got = client(runtime).converse("hi", system="be brief", max_tokens=99, temperature=0.2)
    assert (got.text, got.stop_reason, got.input_tokens, got.output_tokens, got.latency_ms) == ("two sentences.", "end_turn", 11, 5, 120)
    rt.assert_no_pending_responses()


def test_a_reply_cut_short_by_max_tokens_says_so(clients):
    runtime, _, rt, _ = clients
    rt.add_response("converse", reply("partial", stop="max_tokens"), expected())
    assert client(runtime).converse("hi").stop_reason == "max_tokens"


def test_several_text_blocks_are_joined(clients):
    runtime, _, rt, _ = clients
    body = reply()
    body["output"]["message"]["content"] = [{"text": "a"}, {"text": "b"}]
    rt.add_response("converse", body, expected())
    assert client(runtime).converse("hi").text == "ab"


def test_a_reply_with_no_text_is_a_failure_not_an_empty_answer(clients):
    runtime, _, rt, _ = clients
    body = reply(stop="guardrail_intervened")
    body["output"]["message"]["content"] = []
    rt.add_response("converse", body, expected())
    with pytest.raises(ModelFailed, match="guardrail_intervened"):
        client(runtime).converse("hi")


def test_an_empty_prompt_is_refused_before_any_call(clients):
    runtime, _, rt, _ = clients
    with pytest.raises(InvalidRequest):
        client(runtime).converse("   ")
    rt.assert_no_pending_responses()


def test_access_denied_is_not_retried_and_says_how_to_fix_it(clients):
    runtime, _, rt, _ = clients
    error(rt, "AccessDeniedException", "You don't have access to the model", 403)
    sleeps = []
    with pytest.raises(ModelAccessError, match="enable the model"):
        client(runtime, sleeps=sleeps).converse("hi")
    assert sleeps == []
    rt.assert_no_pending_responses()  # exactly one call was made


@pytest.mark.parametrize("code, exc", [("ValidationException", InvalidRequest), ("ResourceNotFoundException", ModelNotFound), ("ModelErrorException", ModelFailed)])
def test_errors_that_a_retry_cannot_fix_are_raised_at_once(clients, code, exc):
    runtime, _, rt, _ = clients
    error(rt, code, "no")
    with pytest.raises(exc):
        client(runtime).converse("hi")
    rt.assert_no_pending_responses()


@pytest.mark.parametrize("code", ["ThrottlingException", "ServiceUnavailableException", "ModelTimeoutException", "ModelNotReadyException", "InternalServerException"])
def test_transient_errors_are_retried_with_doubling_backoff(clients, code):
    runtime, _, rt, _ = clients
    error(rt, code, status=429)
    error(rt, code, status=429)
    rt.add_response("converse", reply("finally"), expected())
    sleeps = []
    assert client(runtime, sleeps=sleeps).converse("hi").text == "finally"
    assert sleeps == [1.0, 2.0]


def test_the_wait_is_jittered_and_never_above_the_cap_for_that_attempt(clients):
    runtime, _, rt, _ = clients
    error(rt, "ThrottlingException", status=429)
    rt.add_response("converse", reply(), expected())
    sleeps = []
    BedrockClient(runtime, MODEL, max_attempts=3, base_delay=4.0, sleep=sleeps.append, jitter=lambda: 0.25).converse("hi")
    assert sleeps == [1.0]


def test_throttling_that_never_clears_stops_after_max_attempts(clients):
    runtime, _, rt, _ = clients
    for _ in range(3):
        error(rt, "ThrottlingException", status=429)
    with pytest.raises(RetriesExhausted, match="3 attempts"):
        client(runtime, attempts=3).converse("hi")
    rt.assert_no_pending_responses()


def test_an_error_code_nobody_listed_is_raised_as_is(clients):
    runtime, _, rt, _ = clients
    error(rt, "ServiceQuotaExceededException")
    with pytest.raises(Exception) as caught:
        client(runtime).converse("hi")
    assert not isinstance(caught.value, BedrockError)
    assert "ServiceQuotaExceededException" in str(caught.value)


def test_at_least_one_attempt_is_required():
    with pytest.raises(ValueError):
        BedrockClient(object(), MODEL, max_attempts=0)


# ---- model access checks ----

def model_details(status="ACTIVE", modalities=("TEXT",)):
    return {"modelDetails": {"modelArn": f"arn:aws:bedrock:ap-southeast-2::foundation-model/{MODEL}", "modelId": MODEL, "modelLifecycle": {"status": status}, "outputModalities": list(modalities)}}


def availability(authorization="AUTHORIZED", entitlement="AVAILABLE", region="AVAILABLE", agreement="AVAILABLE"):
    return {"modelId": MODEL, "agreementAvailability": {"status": agreement}, "authorizationStatus": authorization, "entitlementAvailability": entitlement, "regionAvailability": region}


def check(clients, details=None, avail=None):
    runtime, control, _, ct = clients
    ct.add_response("get_foundation_model", details or model_details(), {"modelIdentifier": MODEL})
    if avail is not False:
        ct.add_response("get_foundation_model_availability", avail or availability(), {"modelId": MODEL})
    client(runtime, control).check_model_access()


def test_an_available_authorized_active_text_model_passes(clients):
    check(clients)


@pytest.mark.parametrize(
    "kwargs, exc",
    [
        (dict(avail=availability(authorization="NOT_AUTHORIZED")), ModelAccessError),
        (dict(avail=availability(entitlement="NOT_AVAILABLE")), ModelAccessError),
        (dict(avail=availability(agreement="PENDING")), ModelAccessError),
        (dict(avail=availability(region="NOT_AVAILABLE")), ModelNotFound),
        (dict(details=model_details(status="LEGACY"), avail=False), ModelAccessError),
        (dict(details=model_details(modalities=("IMAGE",)), avail=False), InvalidRequest),
    ],
)
def test_a_model_the_account_cannot_use_is_refused_with_the_reason(clients, kwargs, exc):
    with pytest.raises(exc):
        check(clients, **kwargs)


@pytest.mark.parametrize("code, exc", [("ResourceNotFoundException", ModelNotFound), ("AccessDeniedException", ModelAccessError)])
def test_the_control_plane_errors_are_translated(clients, code, exc):
    runtime, control, _, ct = clients
    ct.add_client_error("get_foundation_model", service_error_code=code, http_status_code=400)
    with pytest.raises(exc):
        client(runtime, control).check_model_access()


def test_an_access_check_without_a_control_plane_client_says_what_is_missing(clients):
    runtime, _, _, _ = clients
    with pytest.raises(BedrockError, match="control plane"):
        client(runtime).check_model_access()


# ---- dead letter triage (the one place the service uses a model) ----

def test_triage_sends_the_body_and_receive_count_and_returns_the_trimmed_answer(clients):
    runtime, _, rt, _ = clients
    prompt = "Receive count: 3\nBody:\nnot json"
    rt.add_response("converse", reply("  The body is not JSON. A retry will not help.  "), expected(prompt, triage.SYSTEM, 200))
    message = {"Body": "not json", "Attributes": {"ApproximateReceiveCount": "3"}}
    assert triage.summarize_dead_letter(client(runtime), message) == "The body is not JSON. A retry will not help."


def test_triage_cuts_a_huge_body_before_it_reaches_the_model(clients):
    runtime, _, rt, _ = clients
    prompt = "Receive count: unknown\nBody:\n" + "x" * triage.MAX_BODY_CHARS
    rt.add_response("converse", reply("ok"), expected(prompt, triage.SYSTEM, 200))
    triage.summarize_dead_letter(client(runtime), {"Body": "x" * 50_000})
    rt.assert_no_pending_responses()

