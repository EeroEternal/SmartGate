//! Prompt token estimation for cost ranking and budgets.

const TOKENS_PER_CHAR_WIDE: f64 = 1.0;
const CHARS_PER_TOKEN_NARROW: f64 = 4.0;

/// Rough token count: CJK / fullwidth ≈ 1 token/char; Latin ≈ 4 chars/token.
pub fn estimate_tokens_from_text(text: &str) -> u32 {
    let mut wide = 0u32;
    let mut narrow = 0u32;
    for ch in text.chars() {
        if is_wide(ch) {
            wide += 1;
        } else if !ch.is_whitespace() {
            narrow += 1;
        }
    }
    let tokens = wide as f64 * TOKENS_PER_CHAR_WIDE + (narrow as f64 / CHARS_PER_TOKEN_NARROW);
    tokens.ceil().max(1.0) as u32
}

fn is_wide(ch: char) -> bool {
    matches!(
        ch,
        '\u{4E00}'..='\u{9FFF}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{3040}'..='\u{30FF}'
            | '\u{AC00}'..='\u{D7AF}'
            | '\u{FF00}'..='\u{FFEF}'
    )
}

/// Whether the conversation continues past the last user message (tool or
/// assistant turns follow it) — i.e. this request is a mid-loop round of an
/// agent replaying the original task, not a fresh user instruction.
fn continues_after_last_user(msgs: &[serde_json::Value]) -> bool {
    match msgs
        .iter()
        .rev()
        .position(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
    {
        Some(offset) => offset > 0,
        None => false,
    }
}

/// The text that actually drives this turn's difficulty: the latest user
/// instruction, or the original task for mid-loop agent rounds. Tool results
/// are excluded on purpose — they accumulate code, error strings and
/// architecture vocabulary, which would otherwise saturate every agent-loop
/// round at maximum difficulty. Returns `(text, lowercased, is_mid_loop)`.
fn task_focus(body: &serde_json::Value) -> (String, String, bool) {
    let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) else {
        let text = extract_openai_prompt_text(body);
        let lower = text.to_ascii_lowercase();
        return (text, lower, false);
    };
    let is_user = |m: &serde_json::Value| m.get("role").and_then(|r| r.as_str()) == Some("user");
    let content = |m: &serde_json::Value| m.get("content").map(content_to_text).unwrap_or_default();
    let mid_loop = continues_after_last_user(msgs);
    let text = if mid_loop {
        msgs.iter()
            .find(|m| is_user(m))
            .map(content)
            .unwrap_or_default()
    } else {
        msgs.iter()
            .rev()
            .find(|m| is_user(m))
            .map(content)
            .unwrap_or_default()
    };
    let lower = text.to_ascii_lowercase();
    (text, lower, mid_loop)
}

fn has_code_marker(text: &str) -> bool {
    text.contains("```")
        || text.contains("def ")
        || text.contains("fn ")
        || text.contains("class ")
        || text.contains("SELECT ")
        || text.contains("CREATE TABLE")
}

fn has_strong_reasoning_keyword(lower: &str, text: &str) -> bool {
    lower.contains("step by step")
        || lower.contains("step-by-step")
        || lower.contains("root cause")
        || lower.contains("deadlock")
        || lower.contains("benchmark")
        || lower.contains("architecture")
        || lower.contains("architect ")
        || lower.contains("distributed")
        || lower.contains("consensus")
        || lower.contains("paxos")
        || lower.contains("raft")
        || lower.contains("lock-free")
        || lower.contains("lockless")
        || lower.contains("spmc")
        || lower.contains("concurrency")
        || lower.contains("memory barrier")
        || lower.contains("spanner")
        || lower.contains("kernel")
        || lower.contains("algorithm")
        || lower.contains("proof")
        || lower.contains("prove")
        || lower.contains("np-complete")
        || lower.contains("formal")
        || lower.contains("theorem")
        || lower.contains("derivation")
        || lower.contains("derive")
        || lower.contains("parser")
        || lower.contains("compiler")
        || lower.contains("simd")
        || lower.contains("quantum")
        || lower.contains("cryptographic")
        || lower.contains("trade-off")
        || lower.contains("tradeoff")
        || text.contains("逐步")
        || text.contains("推导")
        || text.contains("证明")
        || text.contains("根因")
        || text.contains("死锁")
        || text.contains("架构")
        || text.contains("算法")
        || text.contains("分布式")
        || text.contains("共识")
        || text.contains("无锁")
        || text.contains("并发")
        || text.contains("内核")
        || text.contains("编译器")
        || text.contains("定理")
}

fn has_task_keyword(lower: &str, text: &str) -> bool {
    lower.contains("implement")
        || lower.contains("design")
        || lower.contains("compare")
        || lower.contains("optimize")
        || lower.contains("refactor")
        || lower.contains("migration")
        || lower.contains("debugging")
        || text.contains("设计")
        || text.contains("优化")
        || text.contains("重构")
        || text.contains("对比")
}

fn is_correction(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("wrong")
        || lower.contains("error")
        || lower.contains("failed")
        || lower.contains("still failing")
        || text.contains("不对")
        || text.contains("还是报错")
        || text.contains("理解错了")
        || text.contains("遗漏")
}

/// Extract the most recent user prompt text for intent preview.
///
/// Mid-loop agent rounds carry the original task as the latest user message
/// while tool results stream by; those rounds get a `⟳` marker so operators
/// can tell replayed context from a fresh instruction at a glance.
pub fn extract_user_prompt_preview(body: &serde_json::Value) -> String {
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        if let Some(last_user) = msgs
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        {
            if let Some(content) = last_user.get("content") {
                let text = content_to_text(content);
                let cleaned = text.trim().replace(['\r', '\n', '\t'], " ");
                let single_spaced = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
                let preview: String = single_spaced.chars().take(250).collect();
                if continues_after_last_user(msgs) {
                    return format!("⟳ {preview}");
                }
                return preview;
            }
        }
    }
    extract_openai_prompt_text(body)
        .trim()
        .replace(['\r', '\n', '\t'], " ")
        .chars()
        .take(250)
        .collect()
}

/// Flatten OpenAI-style chat body into text for estimation.
pub fn extract_openai_prompt_text(body: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        for msg in msgs {
            if let Some(content) = msg.get("content") {
                parts.push(content_to_text(content));
            }
        }
    }
    if let Some(tools) = body.get("tools") {
        if let Ok(s) = serde_json::to_string(tools) {
            parts.push(s);
        }
    }
    parts.join("\n")
}

fn content_to_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| {
                b.get("text")
                    .and_then(|t| t.as_str())
                    .or_else(|| b.as_str())
                    .map(|s| s.to_string())
            })
            .collect::<Vec<_>>()
            .join(" "),
        other => other.as_str().unwrap_or("").to_string(),
    }
}

pub fn request_has_tools(body: &serde_json::Value) -> bool {
    body.get("tools")
        .map(|t| t.is_array() && !t.as_array().unwrap().is_empty())
        .unwrap_or(false)
        || body
            .get("functions")
            .map(|t| t.is_array() && !t.as_array().unwrap().is_empty())
            .unwrap_or(false)
}

/// Heuristic task difficulty in [0, 1] for CapabilityAware.
///
/// Task keywords and code markers are scanned on the *user's* text only (the
/// latest instruction, or the original task for mid-loop agent rounds). Tool
/// results are excluded: they almost always contain code, error strings and
/// architecture vocabulary, which used to saturate every round of an agent
/// loop at max difficulty and hard-route routine context accumulation to the
/// strongest endpoint. Context size still contributes, but its total is
/// capped (~0.30) below `DIFFICULTY_HIGH_THRESHOLD` so a big agentic context
/// lands in the cost-routable medium band unless the task itself is hard.
pub fn heuristic_difficulty(body: &serde_json::Value) -> f64 {
    let text = extract_openai_prompt_text(body);
    let (task_text, task_lower, is_mid_loop) = task_focus(body);
    let tokens = estimate_tokens_from_text(&text) as f64;
    let mut d = 0.15;
    // Context load: long contexts need capable models, but must not
    // hard-route by themselves. Ramp caps at +0.20 once past ~4.8k tokens.
    d += (tokens / 24000.0).min(0.20);
    if tokens > 60_000.0 {
        d += 0.05;
    }
    if request_has_tools(body) {
        d += 0.08;
    }
    // Code/schema the USER supplied (pasted code, SQL, API shapes) is a real
    // difficulty signal; code that came back inside tool results is not.
    if has_code_marker(&task_text) {
        d += 0.12;
    }
    if tokens > 12_000.0 {
        d += 0.05;
    }
    // High reasoning & complex system / math / algorithm keywords
    if has_strong_reasoning_keyword(&task_lower, &task_text) {
        d += 0.50;
    } else if has_task_keyword(&task_lower, &task_text) {
        d += 0.25;
    }
    // Multi-turn context & correction cues. Mid-loop agent rounds are
    // structurally multi-turn, and "error"/"failed" inside a fresh user
    // interjection only counts when the user actually spoke last — tool
    // output mentioning errors is noise, not the user correcting the model.
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        if !is_mid_loop && msgs.len() >= 8 {
            d += 0.05;
        }
        if !is_mid_loop
            && msgs
                .last()
                .and_then(|m| m.get("role").and_then(|r| r.as_str()))
                == Some("user")
        {
            let last_text = msgs
                .last()
                .and_then(|m| m.get("content"))
                .map(content_to_text)
                .unwrap_or_default();
            if is_correction(&last_text) {
                d += 0.30;
            }
        }
    }
    d.clamp(0.0, 1.0)
}

pub fn expected_output_tokens(body: &serde_json::Value, default: u32) -> u32 {
    body.get("max_tokens")
        .or_else(|| body.get("max_output_tokens"))
        .and_then(|v| v.as_u64())
        .map(|v| (v as u32).clamp(1, 128_000))
        .unwrap_or(default)
        .max(1)
}

/// Extract human-readable matched complexity signals for inspection and analytics.
///
/// `Code & Schema` and `Long context` describe the request's accumulated
/// context (full text), while intent keywords are matched on the user's task
/// text only — see [`task_focus`] for why tool results are excluded there.
pub fn extract_complexity_signals(body: &serde_json::Value) -> Vec<String> {
    let mut signals = Vec::new();
    let text = extract_openai_prompt_text(body);
    let (task_text, task_lower, is_mid_loop) = task_focus(body);
    let tokens = estimate_tokens_from_text(&text);
    if request_has_tools(body) {
        signals.push("Tools / Functions".to_string());
    }
    if is_mid_loop {
        signals.push("Agent loop".to_string());
    }
    if has_code_marker(&text) {
        signals.push("Code & Schema".to_string());
    }
    if tokens > 6000 {
        signals.push("Long context".to_string());
    }
    if has_strong_reasoning_keyword(&task_lower, &task_text) {
        signals.push("Complex reasoning".to_string());
    } else if has_task_keyword(&task_lower, &task_text) {
        signals.push("System design".to_string());
    }
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        if msgs.len() >= 6 {
            signals.push("Deep multi-turn".to_string());
        }
        if let Some(last_user) = msgs
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        {
            let last_text = last_user
                .get("content")
                .map(content_to_text)
                .unwrap_or_default();
            if is_correction(&last_text) {
                signals.push("Correction feedback".to_string());
            }
        }
    }
    if signals.is_empty() {
        signals.push("General query".to_string());
    }
    signals
}

/// Count characters in tool-role messages (OpenAI shape).
pub fn tool_message_chars(body: &serde_json::Value) -> usize {
    let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) else {
        return 0;
    };
    msgs.iter()
        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("tool"))
        .map(|m| {
            m.get("content")
                .map(|c| content_to_text(c).len())
                .unwrap_or(0)
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cjk_counts_higher_than_latin() {
        let latin = estimate_tokens_from_text("abcd"); // ~1
        let cjk = estimate_tokens_from_text("中文测试"); // ~4
        assert!(cjk > latin);
    }

    #[test]
    fn tools_raise_difficulty() {
        let plain = serde_json::json!({"messages":[{"role":"user","content":"hi"}]});
        let with_tools = serde_json::json!({
            "messages":[{"role":"user","content":"hi"}],
            "tools":[{"type":"function","function":{"name":"x"}}]
        });
        assert!(heuristic_difficulty(&with_tools) > heuristic_difficulty(&plain));
    }

    #[test]
    fn agentic_loop_rounds_do_not_saturate() {
        let tool_noise = format!(
            "fn read_file() {{ class Parser }} SELECT * FROM t; root cause architecture step by step error failed {}",
            "def helper(): pass ".repeat(2000)
        );
        let body = serde_json::json!({
            "messages": [
                {"role": "system", "content": "You are a coding agent for distributed systems architecture."},
                {"role": "user", "content": "User: check the project Assistant module"},
                {"role": "assistant", "content": "I'll read the files."},
                {"role": "tool", "content": tool_noise}
            ],
            "tools": [{"type": "function", "function": {"name": "read_file"}}]
        });
        let d = heuristic_difficulty(&body);
        assert!(
            d < crate::policy::DIFFICULTY_HIGH_THRESHOLD,
            "tool-result noise must not hard-route agent rounds, got {d}"
        );
        // A large accumulated context (typical mid-run round) stays in the
        // cost-routable medium band.
        assert!(
            d >= crate::policy::DIFFICULTY_MEDIUM_THRESHOLD,
            "big agentic context should land medium, got {d}"
        );
    }

    #[test]
    fn hard_tasks_still_route_high() {
        let fresh = serde_json::json!({
            "messages": [
                {"role": "user", "content": "Design a deadlock-free distributed consensus protocol. Prove the correctness invariant, step by step."}
            ]
        });
        assert!(heuristic_difficulty(&fresh) >= crate::policy::DIFFICULTY_HIGH_THRESHOLD);

        // Mid-loop round of the same hard task keeps the original ranking.
        let mid_loop = serde_json::json!({
            "messages": [
                {"role": "user", "content": "Optimize the deadlock in this concurrent parser, prove the fix, step by step"},
                {"role": "assistant", "content": "Reading files."},
                {"role": "tool", "content": "fn main() {} plain tool output"}
            ],
            "tools": [{"type": "function", "function": {"name": "read_file"}}]
        });
        assert!(heuristic_difficulty(&mid_loop) >= crate::policy::DIFFICULTY_HIGH_THRESHOLD);
    }

    #[test]
    fn correction_counts_only_on_fresh_user_turns() {
        // Equal-length tool payloads so only keyword presence could differ.
        let with_tool_noise = serde_json::json!({
            "messages": [
                {"role": "user", "content": "run the tests"},
                {"role": "assistant", "content": "running"},
                {"role": "tool", "content": "error failed wrong still failing output"}
            ]
        });
        let plain = serde_json::json!({
            "messages": [
                {"role": "user", "content": "run the tests"},
                {"role": "assistant", "content": "running"},
                {"role": "tool", "content": "all checks passed with ok output status"}
            ]
        });
        assert!(
            (heuristic_difficulty(&with_tool_noise) - heuristic_difficulty(&plain)).abs() < 1e-9
        );
    }

    #[test]
    fn preview_marks_agent_loop_rounds() {
        let mid_loop = serde_json::json!({
            "messages": [
                {"role": "user", "content": "check the project"},
                {"role": "assistant", "content": "ok"},
                {"role": "tool", "content": "file contents"}
            ]
        });
        assert!(extract_user_prompt_preview(&mid_loop).starts_with("⟳"));
        let fresh = serde_json::json!({
            "messages": [{"role": "user", "content": "hello world"}]
        });
        assert_eq!(extract_user_prompt_preview(&fresh), "hello world");
    }

    #[test]
    fn signals_tag_agent_loops() {
        let mid_loop = serde_json::json!({
            "messages": [
                {"role": "user", "content": "check the project"},
                {"role": "assistant", "content": "ok"},
                {"role": "tool", "content": "```rust\nfn main() {}\n```"}
            ],
            "tools": [{"type": "function", "function": {"name": "read_file"}}]
        });
        let s = extract_complexity_signals(&mid_loop);
        assert!(s.contains(&"Agent loop".to_string()), "signals: {s:?}");
        assert!(
            s.contains(&"Tools / Functions".to_string()),
            "signals: {s:?}"
        );
        assert!(s.contains(&"Code & Schema".to_string()), "signals: {s:?}");
        // Task text has no intent keywords, so none of these appear.
        assert!(
            !s.contains(&"Complex reasoning".to_string()),
            "signals: {s:?}"
        );
    }

    #[test]
    fn reasoning_and_correction_raise_difficulty() {
        let plain = serde_json::json!({"messages":[{"role":"user","content":"hi"}]});
        let reasoning = serde_json::json!({"messages":[{"role":"user","content":"Please explain step by step and prove the theorem"}]});
        let correction = serde_json::json!({
            "messages":[
                {"role":"user","content":"write a sort"},
                {"role":"assistant","content":"here"},
                {"role":"user","content":"不对，你的代码有死锁错误，还是报错"}
            ]
        });
        assert!(heuristic_difficulty(&reasoning) > heuristic_difficulty(&plain));
        assert!(heuristic_difficulty(&correction) > heuristic_difficulty(&plain));
    }
}
