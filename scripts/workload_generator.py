#!/usr/bin/env python3
"""Generate a diverse sample workload against a SmartGate SaaS API key.

Run with:
    export SMARTGATE_API_KEY=pk_...
    export SMARTGATE_BASE_URL=https://api.smartgate.run
    export SMARTGATE_MODEL=fusion
    python3 scripts/workload_generator.py

Scenarios include simple queries, complex reasoning, coding, multi-turn
conversations, user-correction turns, tool-calling multi-turn flows, and
JSON-mode requests. Tool-role messages are injected so that the gateway's
usage_logs record tool_message_chars > 0, which drives schema-compliance
metrics in Quality Analytics.
"""

import json
import os
import random
import sys
import time
import uuid

import requests

BASE_URL = os.environ.get("SMARTGATE_BASE_URL", "https://api.smartgate.run").rstrip("/")
API_KEY = os.environ.get("SMARTGATE_API_KEY")
MODEL = os.environ.get("SMARTGATE_MODEL", "fusion")
BASELINE_MODEL = os.environ.get("SMARTGATE_BASELINE_MODEL", "")

if not API_KEY:
    print("Error: set SMARTGATE_API_KEY", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

ENDPOINT = f"{BASE_URL}/v1/chat/completions"


def chat(payload: dict, tag: str) -> dict:
    """Send one chat completion request and return a small summary."""
    print(f"[{tag}] -> {payload.get('model')}")
    try:
        response = requests.post(ENDPOINT, headers=HEADERS, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()
        usage = data.get("usage") or {}
        choice = (data.get("choices") or [{}])[0]
        finish = choice.get("finish_reason")
        text = choice.get("message", {}).get("content", "")[:120]
        tool_calls = choice.get("message", {}).get("tool_calls")
        print(f"    status={response.status_code} finish={finish} tool_calls={bool(tool_calls)} tokens={usage}")
        print(f"    preview: {text!r}")
        return {"ok": True, "status": response.status_code, "usage": usage, "finish": finish, "tool_calls": tool_calls}
    except Exception as exc:
        print(f"    ERROR: {exc}")
        return {"ok": False, "error": str(exc)}


def simple_greeting():
    return {
        "model": MODEL,
        "messages": [{"role": "user", "content": "Hello! Briefly introduce yourself."}],
        "temperature": 0.7,
    }


def simple_question():
    return {
        "model": MODEL,
        "messages": [{"role": "user", "content": "What is the largest planet in our solar system?"}],
        "temperature": 0.5,
    }


def complex_reasoning():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Explain the trade-offs between breadth-first and depth-first search "
                    "when optimizing LLM routing across multiple model endpoints. "
                    "Consider latency, cost, and quality. Keep under 200 words."
                ),
            }
        ],
        "temperature": 0.3,
    }


def math_reasoning():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": (
                    "A train leaves station A at 60 mph and another leaves station B "
                    "at 80 mph. Stations are 280 miles apart. When do they meet? "
                    "Show your reasoning briefly."
                ),
            }
        ],
        "temperature": 0.3,
    }


def coding_prompt():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Write a Python function that computes the nth Fibonacci number "
                    "using matrix exponentiation in O(log n) time. Include a short docstring."
                ),
            }
        ],
        "temperature": 0.2,
    }


def coding_prompt_2():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": (
                    "Write a Python one-liner to reverse a dictionary keys/values, "
                    "handling duplicate values gracefully by grouping them in a list."
                ),
            }
        ],
        "temperature": 0.2,
    }


def multi_turn_conversation():
    session_id = f"session-{uuid.uuid4().hex[:8]}"
    return {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": "What is the capital of France?"},
            {"role": "assistant", "content": "Paris."},
            {"role": "user", "content": "And what is its population?"},
        ],
        "session_id": session_id,
        "temperature": 0.5,
    }


def multi_turn_correction():
    """Multi-turn where the second user turn is a correction-style follow-up."""
    session_id = f"session-{uuid.uuid4().hex[:8]}"
    return {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": "Who wrote 'To Kill a Mockingbird'?"},
            {"role": "assistant", "content": "Harper Lee wrote To Kill a Mockingbird."},
            {"role": "user", "content": "不对，作者是 Jane Austen 吗？请纠正。"},
        ],
        "session_id": session_id,
        "temperature": 0.5,
    }


def json_mode_prompt():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": "Return a JSON object with keys: city, country, population. Pick any real city.",
            }
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
    }


def json_calc_prompt():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": "What is 127 + 456? Answer with a JSON object containing a single key 'answer'.",
            }
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
    }


def long_context_prompt():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful summarizer. Reply with one sentence.",
            },
            {
                "role": "user",
                "content": "Summarize: " + "SmartGate routes AI requests. " * 80,
            }
        ],
        "temperature": 0.3,
    }


def tool_calling_round():
    """Return the first turn of a tool-calling conversation (no tool-role message yet)."""
    session_id = f"session-{uuid.uuid4().hex[:8]}"
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": "What is 154 + 277? Use the add tool.",
            }
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "add",
                    "description": "Add two integers.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "a": {"type": "integer"},
                            "b": {"type": "integer"},
                        },
                        "required": ["a", "b"],
                    },
                },
            }
        ],
        "session_id": session_id,
        "temperature": 0.1,
    }


def tool_followup_turn(session_id: str, tool_call_id: str, a: int, b: int):
    """Return the second turn with a tool result as a tool-role message."""
    return {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": "What is 154 + 277? Use the add tool."},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": tool_call_id,
                        "type": "function",
                        "function": {"name": "add", "arguments": json.dumps({"a": a, "b": b})},
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": str(a + b),
            },
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "add",
                    "description": "Add two integers.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "a": {"type": "integer"},
                            "b": {"type": "integer"},
                        },
                        "required": ["a", "b"],
                    },
                },
            }
        ],
        "session_id": session_id,
        "temperature": 0.1,
    }


def run_tool_flow(tag_prefix: str):
    """Execute a two-turn tool flow so the second request has tool_message_chars > 0."""
    first = tool_calling_round()
    sid = first["session_id"]
    res1 = chat(first, f"{tag_prefix}-call")
    if not res1.get("ok") or not res1.get("tool_calls"):
        print(f"    Skipping tool follow-up: first turn did not return tool_calls")
        return [res1]

    call = res1["tool_calls"][0]
    call_id = call.get("id", "call_1")
    args = json.loads(call.get("function", {}).get("arguments", "{}"))
    a = args.get("a", 154)
    b = args.get("b", 277)
    time.sleep(0.5)
    res2 = chat(tool_followup_turn(sid, call_id, a, b), f"{tag_prefix}-result")
    return [res1, res2]


def main():
    print(f"base_url={BASE_URL}")
    print(f"model={MODEL}")

    # Build a varied distribution. Tuple: (tag, builder_or_callable).
    # Functions are called fresh each time they are selected.
    scenarios = [
        simple_greeting,
        simple_question,
        complex_reasoning,
        math_reasoning,
        coding_prompt,
        coding_prompt_2,
        multi_turn_conversation,
        multi_turn_correction,
        json_mode_prompt,
        json_calc_prompt,
        long_context_prompt,
    ]

    results = []

    # 1. Run every basic scenario once.
    random.shuffle(scenarios)
    for builder in scenarios:
        tag = builder.__name__.replace("_", "-")
        results.append((tag, chat(builder(), tag)))
        time.sleep(0.5)

    # 2. Add a few duplicates to make the distribution more realistic.
    duplicates = [simple_greeting, simple_question, complex_reasoning, json_calc_prompt]
    for builder in duplicates:
        tag = builder.__name__.replace("_", "-")
        results.append((f"{tag}-repeat", chat(builder(), f"{tag}-repeat")))
        time.sleep(0.5)

    # 3. Run two independent tool flows. These produce tool_message_chars > 0.
    for i in range(2):
        flow_results = run_tool_flow(f"tool-flow-{i+1}")
        results.extend((f"tool-flow-{i+1}", r) for r in flow_results)
        time.sleep(0.5)

    # 5. If a baseline model is configured, send some requests to it so the
    # Quality Analytics control group gets real traffic.
    if BASELINE_MODEL:
        print(f"\nSending 5 requests to baseline model: {BASELINE_MODEL}")
        for i in range(5):
            payload = simple_question()
            payload["model"] = BASELINE_MODEL
            results.append(("baseline", chat(payload, f"baseline-{i+1}")))
            time.sleep(0.5)
    else:
        print("\nTip: set SMARTGATE_BASELINE_MODEL to also populate the baseline control group.")

    ok = sum(1 for _, r in results if r.get("ok"))
    print(f"\nDone. {ok}/{len(results)} requests succeeded.")


if __name__ == "__main__":
    main()
