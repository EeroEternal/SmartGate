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

/// Extract the most recent user prompt text for intent preview.
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
                return single_spaced.chars().take(250).collect();
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
pub fn heuristic_difficulty(body: &serde_json::Value) -> f64 {
    let text = extract_openai_prompt_text(body);
    let lower = text.to_ascii_lowercase();
    let tokens = estimate_tokens_from_text(&text) as f64;
    let mut d = 0.15;
    d += (tokens / 16000.0).min(0.20);
    if request_has_tools(body) {
        d += 0.08;
    }
    if text.contains("```")
        || text.contains("def ")
        || text.contains("fn ")
        || text.contains("class ")
        || text.contains("SELECT ")
        || text.contains("CREATE TABLE")
    {
        d += 0.12;
    }
    if tokens > 12000.0 {
        d += 0.10;
    }
    // High reasoning & complex system / math / algorithm keywords
    if lower.contains("step by step")
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
    {
        d += 0.50;
    } else if lower.contains("implement")
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
    {
        d += 0.25;
    }
    // Multi-turn context & correction cues
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        if msgs.len() >= 8 {
            d += 0.10;
        }
        if let Some(last_user) = msgs.iter().rev().find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user")) {
            let last_text = last_user.get("content").map(content_to_text).unwrap_or_default();
            let last_lower = last_text.to_ascii_lowercase();
            if last_lower.contains("wrong")
                || last_lower.contains("error")
                || last_lower.contains("failed")
                || last_lower.contains("still failing")
                || last_text.contains("不对")
                || last_text.contains("还是报错")
                || last_text.contains("理解错了")
                || last_text.contains("遗漏")
            {
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
pub fn extract_complexity_signals(body: &serde_json::Value) -> Vec<String> {
    let mut signals = Vec::new();
    let text = extract_openai_prompt_text(body);
    let lower = text.to_ascii_lowercase();
    let tokens = estimate_tokens_from_text(&text);
    if request_has_tools(body) {
        signals.push("Tools / Functions".to_string());
    }
    if text.contains("```")
        || text.contains("def ")
        || text.contains("fn ")
        || text.contains("class ")
        || text.contains("SELECT ")
        || text.contains("CREATE TABLE")
    {
        signals.push("Code & Schema".to_string());
    }
    if tokens > 6000 {
        signals.push("Long context".to_string());
    }
    if lower.contains("step by step")
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
    {
        signals.push("Complex reasoning".to_string());
    } else if lower.contains("implement")
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
    {
        signals.push("System design".to_string());
    }
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        if msgs.len() >= 6 {
            signals.push("Deep multi-turn".to_string());
        }
        if let Some(last_user) = msgs.iter().rev().find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user")) {
            let last_text = last_user.get("content").map(content_to_text).unwrap_or_default();
            let last_lower = last_text.to_ascii_lowercase();
            if last_lower.contains("wrong")
                || last_lower.contains("error")
                || last_lower.contains("failed")
                || last_lower.contains("still failing")
                || last_text.contains("不对")
                || last_text.contains("还是报错")
                || last_text.contains("理解错了")
                || last_text.contains("遗漏")
            {
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
