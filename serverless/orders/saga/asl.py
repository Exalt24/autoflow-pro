"""A validator and a small local runner for Amazon States Language (ASL) definitions.

Moto accepts any JSON as a state machine definition and does not run one, so this module covers what the saga needs:
Task, Choice, Pass, Succeed and Fail states, Retry with exponential backoff, Catch with ResultPath, `States.ALL`,
and the rules AWS documents for them (every Next target exists, States.ALL is last, no unreachable state).
It is a subset on purpose. Parameters, InputPath, OutputPath, Map, Parallel and Wait are not supported and the
validator rejects them rather than running them wrongly.
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any, Callable

STATE_TYPES = {"Task", "Choice", "Pass", "Succeed", "Fail"}
UNSUPPORTED_FIELDS = {"Parameters", "InputPath", "OutputPath", "ResultSelector", "TimeoutSeconds", "HeartbeatSeconds"}
TERMINAL_TYPES = {"Succeed", "Fail"}


class DefinitionError(Exception):
    pass


def load_definition(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _targets(state: dict[str, Any], include_catch: bool = True) -> list[str]:
    out: list[str] = []
    if "Next" in state:
        out.append(state["Next"])
    if state.get("Type") == "Choice":
        out.extend(c["Next"] for c in state.get("Choices", []) if "Next" in c)
        if "Default" in state:
            out.append(state["Default"])
    if include_catch:
        out.extend(c["Next"] for c in state.get("Catch", []) if "Next" in c)
    return out


def validate_definition(defn: dict[str, Any]) -> list[str]:
    """Return a list of problems. An empty list means the definition passes the rules this module knows."""
    problems: list[str] = []
    states = defn.get("States")
    if not isinstance(states, dict) or not states:
        return ["States must be a non-empty object"]
    start = defn.get("StartAt")
    if start not in states:
        problems.append(f"StartAt {start!r} is not a state")
    for name, state in states.items():
        kind = state.get("Type")
        if kind not in STATE_TYPES:
            problems.append(f"{name}: unsupported Type {kind!r}")
            continue
        for bad in UNSUPPORTED_FIELDS & set(state):
            problems.append(f"{name}: {bad} is not supported by this runner")
        if kind == "Task" and not state.get("Resource"):
            problems.append(f"{name}: a Task needs a Resource")
        has_next, has_end = "Next" in state, state.get("End") is True
        if kind in ("Task", "Pass") and has_next == has_end:
            problems.append(f"{name}: needs exactly one of Next and End")
        if kind in TERMINAL_TYPES | {"Choice"} and (has_next or has_end):
            problems.append(f"{name}: a {kind} state has no Next or End")
        if kind == "Choice" and not state.get("Choices"):
            problems.append(f"{name}: a Choice needs Choices")
        for target in _targets(state):
            if target not in states:
                problems.append(f"{name}: Next target {target!r} is not a state")
        for key in ("Retry", "Catch"):
            rules = state.get(key, [])
            if rules and kind != "Task":
                problems.append(f"{name}: {key} is only valid on a Task here")
            for index, rule in enumerate(rules):
                errors = rule.get("ErrorEquals")
                if not errors or not isinstance(errors, list):
                    problems.append(f"{name}: {key}[{index}] needs ErrorEquals")
                    continue
                if "States.ALL" in errors and (errors != ["States.ALL"] or index != len(rules) - 1):
                    problems.append(f"{name}: States.ALL must be alone and in the last {key} rule")
                if key == "Retry":
                    if rule.get("MaxAttempts", 3) < 0:
                        problems.append(f"{name}: Retry[{index}] MaxAttempts must be 0 or more")
                    if rule.get("BackoffRate", 2.0) < 1.0:
                        problems.append(f"{name}: Retry[{index}] BackoffRate must be 1.0 or more")
                    if rule.get("IntervalSeconds", 1) < 1:
                        problems.append(f"{name}: Retry[{index}] IntervalSeconds must be 1 or more")
                elif "Next" not in rule:
                    problems.append(f"{name}: Catch[{index}] needs Next")
    if problems:
        return problems
    reachable = _reach(states, start)
    for name in states:
        if name not in reachable:
            problems.append(f"{name}: not reachable from StartAt")
    for name in reachable:
        if not _reaches_terminal(states, name):
            problems.append(f"{name}: no path from here ends the execution")
    return problems


def _reach(states: dict[str, Any], start: str) -> set[str]:
    seen, stack = set(), [start]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        stack.extend(_targets(states[name]))
    return seen


def _reaches_terminal(states: dict[str, Any], name: str) -> bool:
    seen, stack = set(), [name]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        state = states[current]
        if state["Type"] in TERMINAL_TYPES or state.get("End") is True:
            return True
        stack.extend(_targets(state))
    return False


def compensation_gaps(defn: dict[str, Any]) -> list[str]:
    """Saga rule: when a forward step fails, its catch path must run its own compensation and that of every step before it.

    Its own too, because a call that failed or timed out may still have done its work.

    States are tagged in `Comment`: "forward" for a step with a side effect, "compensates <Step>" for its undo.
    """
    states = defn["States"]
    forward = [n for n, s in states.items() if s.get("Comment") == "forward"]
    comp_for = {s["Comment"].split(" ", 1)[1]: n for n, s in states.items() if s.get("Comment", "").startswith("compensates ")}
    gaps: list[str] = []
    for step in forward:
        ancestors = {a for a in forward if a != step and step in _reach_no_catch(states, a)}
        catch_all = [c for c in states[step].get("Catch", []) if "States.ALL" in c["ErrorEquals"]]
        if not catch_all:
            gaps.append(f"{step}: no Catch with States.ALL, a failure would leave earlier steps done")
            continue
        visited = _path_states(states, catch_all[0]["Next"])
        for earlier in sorted(ancestors | {step}):
            comp = comp_for.get(earlier)
            if comp is None:
                if earlier != step:  # a step with nothing to undo (a confirm) is allowed
                    gaps.append(f"{earlier}: no compensation state")
            elif comp not in visited:
                gaps.append(f"{step}: failing here does not run {comp}")
    return sorted(set(gaps))


def _reach_no_catch(states: dict[str, Any], start: str) -> set[str]:
    seen, stack = set(), [start]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        stack.extend(_targets(states[name], include_catch=False))
    return seen


def _path_states(states: dict[str, Any], first: str) -> list[str]:
    path, current = [], first
    while current not in path:
        path.append(current)
        state = states[current]
        if state["Type"] in TERMINAL_TYPES or "Next" not in state:
            break
        current = state["Next"]
    return path


# ---- JSONPath (only `$` and `$.a.b` are needed) ----

def _get(doc: Any, path: str) -> Any:
    if path == "$":
        return doc
    cur = doc
    for part in path[2:].split("."):
        if not isinstance(cur, dict) or part not in cur:
            raise KeyError(path)
        cur = cur[part]
    return cur


def _set(doc: dict[str, Any], path: str | None, value: Any) -> dict[str, Any]:
    if path is None:
        return doc
    if path == "$":
        return value
    parts = path[2:].split(".")
    cur = doc
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value
    return doc


def _choice_matches(rule: dict[str, Any], data: dict[str, Any]) -> bool:
    if "And" in rule:
        return all(_choice_matches(r, data) for r in rule["And"])
    if "Or" in rule:
        return any(_choice_matches(r, data) for r in rule["Or"])
    if "Not" in rule:
        return not _choice_matches(rule["Not"], data)
    try:
        value = _get(data, rule["Variable"])
    except KeyError:
        return False
    ops: dict[str, Callable[[Any, Any], bool]] = {
        "StringEquals": lambda a, b: a == b,
        "NumericEquals": lambda a, b: a == b,
        "NumericGreaterThan": lambda a, b: a > b,
        "NumericGreaterThanEquals": lambda a, b: a >= b,
        "NumericLessThan": lambda a, b: a < b,
        "NumericLessThanEquals": lambda a, b: a <= b,
        "BooleanEquals": lambda a, b: a is b,
    }
    for op, fn in ops.items():
        if op in rule:
            return fn(value, rule[op])
    raise DefinitionError(f"unsupported Choice operator in {rule}")


@dataclass
class Execution:
    status: str  # SUCCEEDED or FAILED
    output: dict[str, Any]
    error: str | None = None
    cause: str | None = None
    path: list[str] = field(default_factory=list)  # states entered, in order
    retries: list[tuple[str, int, int]] = field(default_factory=list)  # (state, attempt, seconds waited)


TaskFn = Callable[[dict[str, Any]], Any]


def run(defn: dict[str, Any], tasks: dict[str, TaskFn], payload: dict[str, Any], sleep: Callable[[float], None] = lambda s: None, max_steps: int = 200) -> Execution:
    """Run a definition. `tasks` maps a Task Resource to a function that takes the state input and returns its result.

    A task function signals failure by raising; the exception class name is the ASL error name (as in Lambda).
    `sleep` receives each retry delay, so tests can check the backoff without waiting.
    """
    problems = validate_definition(defn)
    if problems:
        raise DefinitionError("; ".join(problems))
    states = defn["States"]
    data = copy.deepcopy(payload)
    current = defn["StartAt"]
    execution = Execution("RUNNING", data)
    for _ in range(max_steps):
        execution.path.append(current)
        state = states[current]
        kind = state["Type"]
        if kind == "Succeed":
            execution.status, execution.output = "SUCCEEDED", data
            return execution
        if kind == "Fail":
            execution.status, execution.output = "FAILED", data
            execution.error, execution.cause = state.get("Error"), state.get("Cause")
            return execution
        if kind == "Pass":
            if "Result" in state:
                data = _set(data, state.get("ResultPath", "$"), copy.deepcopy(state["Result"]))
        elif kind == "Choice":
            nxt = state.get("Default")
            for rule in state["Choices"]:
                if _choice_matches(rule, data):
                    nxt = rule["Next"]
                    break
            if nxt is None:
                execution.status, execution.output = "FAILED", data
                execution.error, execution.cause = "States.NoChoiceMatched", current
                return execution
            current = nxt
            continue
        elif kind == "Task":
            try:
                result = _attempt(state, tasks, data, current, execution, sleep)
            except DefinitionError:
                raise  # a missing function is a wiring mistake, not a task failure a Catch may swallow
            except Exception as exc:  # noqa: BLE001
                name = type(exc).__name__
                handler = _find_rule(state.get("Catch", []), name)
                if handler is None:
                    execution.status, execution.output = "FAILED", data
                    execution.error, execution.cause = name, str(exc)
                    return execution
                data = _set(data, handler.get("ResultPath", "$"), {"Error": name, "Cause": str(exc)})
                current = handler["Next"]
                continue
            data = _set(data, state.get("ResultPath", "$"), result)
        if state.get("End") is True:
            execution.status, execution.output = "SUCCEEDED", data
            return execution
        current = state["Next"]
    raise DefinitionError(f"more than {max_steps} steps: the definition loops")


def _find_rule(rules: list[dict[str, Any]], error: str) -> dict[str, Any] | None:
    for rule in rules:
        names = rule["ErrorEquals"]
        if "States.ALL" in names or "States.TaskFailed" in names or error in names:
            return rule
    return None


def _attempt(state: dict[str, Any], tasks: dict[str, TaskFn], data: dict[str, Any], name: str, execution: Execution, sleep: Callable[[float], None]) -> Any:
    resource = state["Resource"]
    if resource not in tasks:
        raise DefinitionError(f"{name}: no function wired for {resource}")
    attempts: dict[int, int] = {}  # retry rule index -> attempts used so far
    while True:
        try:
            return tasks[resource](copy.deepcopy(data))
        except Exception as exc:  # noqa: BLE001
            error = type(exc).__name__
            rules = state.get("Retry", [])
            rule = _find_rule(rules, error)
            if rule is None:
                raise
            index = rules.index(rule)
            used = attempts.get(index, 0)
            if used >= rule.get("MaxAttempts", 3):
                raise
            attempts[index] = used + 1
            delay = int(rule.get("IntervalSeconds", 1) * (rule.get("BackoffRate", 2.0) ** used))
            execution.retries.append((name, used + 1, delay))
            sleep(delay)
