"""A strangler fig facade: one entry point in front of a legacy handler and its replacement.

The router takes an API Gateway HTTP API (payload format 2.0) event and returns an API Gateway proxy response, so it
can be the Lambda behind a `$default` route. A route table says, per route, where traffic goes:

    legacy      every call goes to the old system (the default for anything not listed)
    modern      every call goes to the new one
    canary      `percent` of callers go to the new one, chosen by a stable hash of the caller key
    allowlist   only the listed callers go to the new one

Moving a route is one edit of one row, and a route's behaviour never depends on another route's row. A `fallback`
flag sends a call back to the legacy handler when the new one fails with a server error, so a bad release degrades
instead of failing the call. The caller key is the customer id from the path or the query string; the same caller
always lands on the same side, which keeps a customer from flipping between two systems mid-session.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

Handler = Callable[[dict[str, Any]], dict[str, Any]]
MODES = ("legacy", "modern", "canary", "allowlist")


@dataclass(frozen=True)
class Rule:
    mode: str = "legacy"
    percent: int = 0
    allow: frozenset[str] = field(default_factory=frozenset)
    fallback: bool = True

    def __post_init__(self) -> None:
        if self.mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        if not 0 <= self.percent <= 100:
            raise ValueError("percent must be between 0 and 100")


def bucket(key: str) -> int:
    """A stable number 0..99 for a caller key (the same key is in the same bucket on every call and every host)."""
    return int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16) % 100


def _pattern(route: str) -> tuple[str, re.Pattern[str]]:
    method, path = route.split(" ", 1)
    regex = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", path)
    return method, re.compile(f"^{regex}$")


class StranglerRouter:
    def __init__(self, legacy: Handler, modern: Handler, rules: dict[str, Rule]):
        self.legacy, self.modern, self.rules = legacy, modern, dict(rules)
        self._patterns = {route: _pattern(route) for route in rules}
        self.log: list[tuple[str, str]] = []  # (route, side) of every call, for tests and for a cutover review

    def match(self, method: str, path: str) -> tuple[str | None, dict[str, str]]:
        for route, (m, regex) in self._patterns.items():
            found = regex.match(path)
            if m == method and found:
                return route, found.groupdict()
        return None, {}

    def side_for(self, route: str | None, key: str) -> str:
        rule = self.rules.get(route) if route else None
        if rule is None or rule.mode == "legacy":
            return "legacy"
        if rule.mode == "modern":
            return "modern"
        if rule.mode == "allowlist":
            return "modern" if key in rule.allow else "legacy"
        return "modern" if bucket(key) < rule.percent else "legacy"

    def handle(self, event: dict[str, Any], context: Any = None) -> dict[str, Any]:
        http = event["requestContext"]["http"]
        route, params = self.match(http["method"], http["path"])
        key = params.get("customer_id") or (event.get("queryStringParameters") or {}).get("customer_id") or ""
        call = {"method": http["method"], "path": http["path"], "params": params, "query": event.get("queryStringParameters") or {}, "body": event.get("body")}
        side = self.side_for(route, key)
        if side == "modern":
            try:
                result = self.modern(call)
                if result["statusCode"] >= 500 and self.rules[route].fallback:
                    raise RuntimeError("modern handler answered 5xx")
            except Exception:  # noqa: BLE001
                if not self.rules[route].fallback:
                    raise
                side, result = "legacy", self.legacy(call)
        else:
            result = self.legacy(call)
        self.log.append((route or "unmatched", side))
        return {
            "statusCode": result["statusCode"],
            "headers": {"content-type": "application/json", "x-served-by": side},
            "body": json.dumps(result["body"]),
        }
