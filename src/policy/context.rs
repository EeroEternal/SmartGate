//! Context slim: quality-preserving reduction of aged tool results.
//!
//! No session_id required. Uses message order in the current request body:
//! - Newest tool results kept (still needed for the current turn)
//! - Older tool bodies replaced with short placeholders (already "consumed")
//!
//! See `docs/scope.md` — Cost efficiency without becoming an agent runtime.

#[derive(Debug, Clone)]
pub struct SlimConfig {
    /// Keep this many most recent tool messages at full (or hard-capped) size.
    pub keep_recent_full: usize,
    /// Hard cap on the newest tool body (chars). 0 = no cap.
    pub max_newest_chars: usize,
    /// Cap for the next older tool (age == keep_recent_full).
    pub max_recent_chars: usize,
}

impl Default for SlimConfig {
    fn default() -> Self {
        Self {
            keep_recent_full: 1,
            max_newest_chars: 32_000,
            max_recent_chars: 4_000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SlimResult {
    pub body: serde_json::Value,
    pub original_tool_chars: usize,
    pub slimmed_chars: usize,
    pub modified: bool,
    pub tools_touched: usize,
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

fn head_tail(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        return text.to_string();
    }
    let head_len = (max_chars as f64 * 0.7) as usize;
    let tail_len = max_chars.saturating_sub(head_len + 80);
    let head: String = text.chars().take(head_len).collect();
    let tail: String = text
        .chars()
        .rev()
        .take(tail_len)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    let omitted = text.len().saturating_sub(head.len() + tail.len());
    format!("{head}\n...[truncated by SmartGate: {omitted} chars]...\n{tail}")
}

/// Short clue for omitted tool body (file name / first line) without keeping payload.
fn placeholder(text: &str, tool_call_id: Option<&str>, original_len: usize) -> String {
    let clue: String = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| {
            let s: String = l.chars().take(80).collect();
            if l.chars().count() > 80 {
                format!("{s}…")
            } else {
                s
            }
        })
        .unwrap_or_else(|| "tool output".into());
    let id = tool_call_id.unwrap_or("-");
    format!("[prior tool result omitted by SmartGate: ~{original_len} chars, id={id}, clue={clue}]")
}

/// Age-based tool slim: no session_id; works on multi-turn history already in `messages`.
pub fn slim_tool_messages(mut body: serde_json::Value, cfg: &SlimConfig) -> SlimResult {
    let mut original = 0usize;
    let mut saved = 0usize;
    let mut modified = false;
    let mut touched = 0usize;

    let Some(msgs) = body.get_mut("messages").and_then(|m| m.as_array_mut()) else {
        return SlimResult {
            body,
            original_tool_chars: 0,
            slimmed_chars: 0,
            modified: false,
            tools_touched: 0,
        };
    };

    // Collect indices of tool messages in order (old → new).
    let tool_indices: Vec<usize> = msgs
        .iter()
        .enumerate()
        .filter(|(_, m)| m.get("role").and_then(|r| r.as_str()) == Some("tool"))
        .map(|(i, _)| i)
        .collect();

    let n = tool_indices.len();
    if n == 0 {
        return SlimResult {
            body,
            original_tool_chars: 0,
            slimmed_chars: 0,
            modified: false,
            tools_touched: 0,
        };
    }

    for (rank, &idx) in tool_indices.iter().enumerate() {
        // age 0 = newest tool
        let age = n - 1 - rank;
        let msg = &mut msgs[idx];
        let tool_call_id = msg
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let Some(content) = msg.get("content") else {
            continue;
        };
        let text = content_to_text(content);
        original += text.len();

        let new_content = if age < cfg.keep_recent_full {
            // Newest tier: optional hard cap only.
            if cfg.max_newest_chars > 0 && text.len() > cfg.max_newest_chars {
                Some(head_tail(&text, cfg.max_newest_chars))
            } else {
                None
            }
        } else if age == cfg.keep_recent_full {
            // One step older: moderate head+tail.
            if text.len() > cfg.max_recent_chars {
                Some(head_tail(&text, cfg.max_recent_chars))
            } else {
                None
            }
        } else {
            // Older: replace with quality-preserving placeholder (keeps clue, drops body).
            Some(placeholder(
                &text,
                tool_call_id.as_deref(),
                text.len(),
            ))
        };

        if let Some(new_c) = new_content {
            let before = text.len();
            let after = new_c.len();
            if after < before {
                saved += before - after;
                modified = true;
                touched += 1;
                msg["content"] = serde_json::Value::String(new_c);
            }
        }
    }

    SlimResult {
        body,
        original_tool_chars: original,
        slimmed_chars: saved,
        modified,
        tools_touched: touched,
    }
}

/// Backward-compatible name: uniform cap is weaker; prefer [`slim_tool_messages`].
pub fn trim_tool_messages(body: serde_json::Value, max_tool_chars: usize) -> SlimResult {
    let cfg = SlimConfig {
        keep_recent_full: 1,
        max_newest_chars: max_tool_chars,
        max_recent_chars: max_tool_chars.min(4_000),
    };
    slim_tool_messages(body, &cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ages_old_tools_keeps_newest() {
        let ancient = "ANCIENT".repeat(3_000);
        let mid = "MID".repeat(5_000);
        let newest = "NEW_RESULT_CONTENT_HERE";
        let body = serde_json::json!({
            "messages": [
                {"role":"user","content":"fix bug"},
                {"role":"tool","tool_call_id":"c0","content": ancient},
                {"role":"tool","tool_call_id":"c1","content": mid},
                {"role":"tool","tool_call_id":"c2","content": newest},
                {"role":"user","content":"continue"}
            ]
        });
        let out = slim_tool_messages(body, &SlimConfig::default());
        assert!(out.modified);
        assert!(out.slimmed_chars > 0);
        let msgs = out.body["messages"].as_array().unwrap();
        let oldest = msgs[1]["content"].as_str().unwrap();
        let middle = msgs[2]["content"].as_str().unwrap();
        let new = msgs[3]["content"].as_str().unwrap();
        // age>=2 → placeholder
        assert!(oldest.contains("omitted") || oldest.contains("prior tool"));
        // age==1 → head+tail truncate
        assert!(middle.contains("truncated") || middle.len() < mid.len());
        // age==0 → full keep
        assert!(new.contains("NEW_RESULT"));
        assert_eq!(msgs[1]["tool_call_id"], "c0");
        assert_eq!(msgs[3]["tool_call_id"], "c2");
    }

    #[test]
    fn no_tools_noop() {
        let body = serde_json::json!({
            "messages": [{"role":"user","content":"hi"}]
        });
        let out = slim_tool_messages(body, &SlimConfig::default());
        assert!(!out.modified);
    }
}
