# Harness, agents & client integration

SmartGate is an **AI gateway** on the **model API path** (Cost · Control · Choice for every inference).  
It does **not** replace coding harnesses (Claude Code, Cursor, Codex) or meta-harnesses ([Omnigent](https://omnigent.ai/)).

## Agents

**Yes — treat agents as first-class clients.** Point the agent’s OpenAI-compatible base URL at SmartGate.  
Same keys, Virtual Models, smart routing, and budgets as any backend app.

**No — SmartGate is not an agent runtime** (no tool sandbox, no task dispatch across harnesses).

## MCP

**No MCP registry or MCP proxy in SmartGate core.**  
If an agent uses MCP tools locally (or via another MCP client) and only sends **chat/completions** to SmartGate, Cost/Control already apply.

Do not wait on “MCP support” to ship agent integrations.

## Point any OpenAI-compatible client at SmartGate

```text
Base URL:  http://127.0.0.1:18765/v1
API Key:   <project API key from Admin → Access>
Model:     <Virtual Model name>
```

Example:

```bash
curl -sS http://127.0.0.1:18765/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fast-chat",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

## Recommended setup for lower spend

1. Create two endpoints with **different prices** (cheap OSS + frontier).
2. Put both in one Model Pool with strategy **`cost_aware`** or **`capability_aware`**.
3. Expose a Virtual Model name clients already use.
4. Optional: set **daily_spend_limit** on the API key (soft gate at 80% downshifts to cheaper endpoints; hard block at 100%).

## Context bloat (harness vs gateway)

| Where | What to do |
|-------|------------|
| **Harness** | Prefer less verbose tools, more frequent compaction, smaller task units |
| **SmartGate pool** | Enable tool trim (`tool_trim_enabled`, prefer dry-run first) for a safety net |

Gateway trim is a last resort for `role=tool` messages; primary savings still come from model mix + smart/cost routing.

## Omnigent / meta-harness

Use Omnigent (or similar) for **task-level** harness selection. Point each underlying agent’s model base URL at SmartGate for **request-level** cost and budget policy.
