"""A small Amazon Bedrock client: the Converse API with a model access check and error handling.

Written from the Bedrock documentation (the Converse operation of `bedrock-runtime`, and `GetFoundationModel` and
`GetFoundationModelAvailability` of `bedrock`). It has only been run against stand-ins: botocore's own request
validation through its Stubber, and a hand written fake client. It has never called a real Bedrock endpoint.

Error handling follows the documented error shapes of Converse:
  AccessDeniedException                      the account has no access to the model: raise ModelAccessError, never retry
  ResourceNotFoundException                  the model id does not exist in this region: raise ModelNotFound
  ValidationException                        the request is wrong: raise InvalidRequest, never retry
  ThrottlingException, ServiceUnavailableException, ModelTimeoutException,
  ModelNotReadyException, InternalServerException   worth retrying with exponential backoff and jitter
  ModelErrorException                        the model failed on this input: raise ModelFailed
A reply that stopped for a reason other than end_turn is surfaced in `stop_reason`, and a reply with no text block raises.
"""
from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any, Callable

from botocore.exceptions import ClientError

RETRYABLE = {"ThrottlingException", "ServiceUnavailableException", "ModelTimeoutException", "ModelNotReadyException", "InternalServerException"}


class BedrockError(Exception):
    pass


class ModelAccessError(BedrockError):
    pass


class ModelNotFound(BedrockError):
    pass


class InvalidRequest(BedrockError):
    pass


class ModelFailed(BedrockError):
    pass


class RetriesExhausted(BedrockError):
    pass


@dataclass(frozen=True)
class Reply:
    text: str
    stop_reason: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


def _code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


class BedrockClient:
    """`runtime` is a `bedrock-runtime` client and `control` a `bedrock` client (needed only for access checks)."""

    def __init__(
        self,
        runtime: Any,
        model_id: str,
        control: Any | None = None,
        max_attempts: int = 4,
        base_delay: float = 0.5,
        sleep: Callable[[float], None] = time.sleep,
        jitter: Callable[[], float] = random.random,
    ):
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self.runtime, self.control, self.model_id = runtime, control, model_id
        self.max_attempts, self.base_delay, self.sleep, self.jitter = max_attempts, base_delay, sleep, jitter

    def check_model_access(self, model_id: str | None = None) -> None:
        """Raise unless the account can call the model: it exists, is ACTIVE, takes text and is authorized here."""
        if self.control is None:
            raise BedrockError("an access check needs the bedrock control plane client")
        model = model_id or self.model_id
        try:
            details = self.control.get_foundation_model(modelIdentifier=model)["modelDetails"]
        except ClientError as exc:
            if _code(exc) == "ResourceNotFoundException":
                raise ModelNotFound(model) from exc
            if _code(exc) == "AccessDeniedException":
                raise ModelAccessError(f"the role may not read {model}") from exc
            raise
        if details.get("modelLifecycle", {}).get("status") != "ACTIVE":
            raise ModelAccessError(f"{model} is {details.get('modelLifecycle', {}).get('status')}, not ACTIVE")
        if "TEXT" not in details.get("outputModalities", []):
            raise InvalidRequest(f"{model} does not produce text")
        availability = self.control.get_foundation_model_availability(modelId=model)
        if availability["regionAvailability"] != "AVAILABLE":
            raise ModelNotFound(f"{model} is not offered in this region")
        if availability["authorizationStatus"] != "AUTHORIZED" or availability["entitlementAvailability"] != "AVAILABLE":
            raise ModelAccessError(f"this account has no access to {model}")
        status = availability.get("agreementAvailability", {}).get("status")
        if status not in (None, "AVAILABLE"):
            raise ModelAccessError(f"the model agreement for {model} is {status}")

    def converse(self, prompt: str, system: str | None = None, max_tokens: int = 512, temperature: float = 0.0) -> Reply:
        if not prompt.strip():
            raise InvalidRequest("the prompt is empty")
        request: dict[str, Any] = {
            "modelId": self.model_id,
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
        }
        if system:
            request["system"] = [{"text": system}]
        response = self._call(request)
        blocks = response.get("output", {}).get("message", {}).get("content", [])
        text = "".join(b["text"] for b in blocks if "text" in b)
        if not text:
            raise ModelFailed(f"no text in the reply (stop reason {response.get('stopReason')})")
        usage = response.get("usage", {})
        return Reply(
            text=text,
            stop_reason=response.get("stopReason", ""),
            input_tokens=usage.get("inputTokens", 0),
            output_tokens=usage.get("outputTokens", 0),
            latency_ms=response.get("metrics", {}).get("latencyMs", 0),
        )

    def _call(self, request: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(1, self.max_attempts + 1):
            try:
                return self.runtime.converse(**request)
            except ClientError as exc:
                code = _code(exc)
                if code == "AccessDeniedException":
                    raise ModelAccessError(f"access denied for {self.model_id}: enable the model for this account and region") from exc
                if code == "ResourceNotFoundException":
                    raise ModelNotFound(self.model_id) from exc
                if code == "ValidationException":
                    raise InvalidRequest(exc.response["Error"].get("Message", "")) from exc
                if code == "ModelErrorException":
                    raise ModelFailed(exc.response["Error"].get("Message", "")) from exc
                if code not in RETRYABLE:
                    raise
                if attempt == self.max_attempts:
                    raise RetriesExhausted(f"{code} after {attempt} attempts") from exc
                # full jitter: wait a random time up to base * 2^(attempt-1)
                self.sleep(self.base_delay * (2 ** (attempt - 1)) * self.jitter())
        raise AssertionError("unreachable")
