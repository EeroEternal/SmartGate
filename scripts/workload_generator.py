#!/usr/bin/env python3
"""Generate sample workload requests against a SmartGate SaaS API key.

Run with:
    export SMARTGATE_API_KEY=pk_...
    export SMARTGATE_BASE_URL=https://smartgate.run
    python3 scripts/workload_generator.py

The script sends a small mixed distribution of requests:
- Simple greeting
- Complex reasoning / coding
- Multi-turn conversation (shares session_id)
- Tool-calling style prompt
- Long-context style prompt
"""

import json
import os
import random
import sys
import time
import uuid

import requests

BASE_URL = os.environ.get("SMARTGATE_BASE_URL", "https://smartgate.run").rstrip("/")
API_KEY = os.environ.get("SMARTGATE_API_KEY")
MODEL = os.environ.get("SMARTGATE_MODEL", "fusion")

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
        print(f"    status={response.status_code} finish={finish} tokens={usage}")
        print(f"    preview: {text!r}")
        return {"ok": True, "status": response.status_code, "usage": usage, "finish": finish}
    except Exception as exc:
        print(f"    ERROR: {exc}")
        return {"ok": False, "error": str(exc)}


def simple_greeting():
    return {
        "model": MODEL,
        "messages": [{"role": "user", "content": "Hello! Briefly introduce yourself."}],
        "temperature": 0.7,
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


def tool_style_prompt():
    return {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": "What is 127 + 456? Please answer with a JSON object containing a single key 'answer'.",
            }
        ],
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


def main():
    print(f"base_url={BASE_URL}")
    print(f"model={MODEL}")

    scenarios = [
        ("simple", simple_greeting),
        ("complex", complex_reasoning),
        ("coding", coding_prompt),
        ("multi-turn", multi_turn_conversation),
        ("tool-style", tool_style_prompt),
        ("long-context", long_context_prompt),
    ]

    # Randomize order and add one duplicate simple request to create a distribution.
    random.shuffle(scenarios)
    results = []
    for tag, builder in scenarios:
        results.append((tag, chat(builder(), tag)))
        time.sleep(0.5)

    # One extra simple request to balance the sample distribution.
    results.append(("simple", chat(simple_greeting(), "simple-repeat")))

    ok = sum(1 for _, r in results if r.get("ok"))
    print(f"\nDone. {ok}/{len(results)} requests succeeded.")


if __name__ == "__main__":
    main()
