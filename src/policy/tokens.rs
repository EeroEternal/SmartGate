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
    d += (tokens / 8000.0).min(0.35);
    if request_has_tools(body) {
        d += 0.2;
    }
    if text.contains("```")
        || text.contains("def ")
        || text.contains("fn ")
        || text.contains("class ")
        || text.contains("SELECT ")
        || text.contains("CREATE TABLE")
    {
        d += 0.15;
    }
    if tokens > 12000.0 {
        d += 0.15;
    }
    // High reasoning keywords / intent patterns
    if lower.contains("step by step")
        || lower.contains("step-by-step")
        || lower.contains("root cause")
        || lower.contains("deadlock")
        || lower.contains("benchmark")
        || lower.contains("architecture")
        || text.contains("逐步")
        || text.contains("推导")
        || text.contains("证明")
        || text.contains("根因")
        || text.contains("死锁")
        || text.contains("架构")
        || text.contains("算法")
    {
        d += 0.20;
    }
    // Multi-turn context & correction cues
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        if msgs.len() >= 6 {
            d += 0.15;
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
                d += 0.25;
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
