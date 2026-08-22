//! Context slim: quality-preserving reduction of aged tool results.
//!
//! No session_id required. Trimming decisions are **pure functions of the
//! message content**, never of message position: agent harnesses resend the
//! full history every turn, and an upstream provider's prefix cache survives
//! only if unchanged messages render byte-identically across turns. Age-based
//! tiering ("newest kept full, older truncated, oldest replaced") would
//! re-render the same message differently as the conversation grows, breaking
//! the cache at that message on every turn.
//!
//! Rules (OpenAI `role:"tool"` messages and Anthropic `type:"tool_result"`
//! blocks are both covered; content is replaced in place so tool-call pairing
//! is never orphaned):
//! - Body larger than `max_tool_chars`: head+tail capped to `max_tool_chars`.
//! - Body larger than `placeholder_after` chars: replaced with a short
//!   content-derived placeholder (id, original length, first-line clue).
//!
//! See `docs/scope.md` — Cost efficiency without becoming an agent runtime.
//! See `docs/design/freetoken_analysis.md` §4.2 for the stability contract.

#[derive(Debug, Clone)]
pub struct SlimConfig {
    /// Cap for any tool body (chars). Bodies larger than this are head+tail capped.
    pub max_tool_chars: usize,
    /// Bodies larger than this are replaced entirely with a placeholder.
    /// Must be >= `max_tool_chars`; 0 disables placeholder replacement.
    pub placeholder_after: usize,
}

impl Default for SlimConfig {
    fn default() -> Self {
        let max_tool_chars = 32_000;
        Self {
            max_tool_chars,
            placeholder_after: max_tool_chars * 4,
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

/// Deterministic replacement decision for one tool body. Pure function of the
/// body text and config: the same content always renders the same way,
/// regardless of how many newer tool messages arrive in later turns.
enum SlimAction {
    /// Replace the whole body with a content-derived placeholder.
    Placeholder,
    /// Keep head+tail, capped to `max_tool_chars`.
    Cap(String),
}

fn slim_action(text: &str, cfg: &SlimConfig) -> Option<SlimAction> {
    if cfg.placeholder_after > 0 && text.len() > cfg.placeholder_after {
        Some(SlimAction::Placeholder)
    } else if text.len() > cfg.max_tool_chars {
        Some(SlimAction::Cap(head_tail(text, cfg.max_tool_chars)))
    } else {
        None
    }
}

/// Age-based tool slim replaced by content-only rules: works on multi-turn
/// history already in `messages` without any session state.
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

    for msg in msgs.iter_mut() {
        // OpenAI format: standalone role:"tool" messages.
        if msg.get("role").and_then(|r| r.as_str()) == Some("tool") {
            let tool_call_id = msg
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let Some(content) = msg.get("content") else {
                continue;
            };
            let text = content_to_text(content);
            original += text.len();
            let replacement = match slim_action(&text, cfg) {
                Some(SlimAction::Placeholder) => {
                    Some(placeholder(&text, tool_call_id.as_deref(), text.len()))
                }
                Some(SlimAction::Cap(capped)) => Some(capped),
                None => None,
            };
            if let Some(new_c) = replacement {
                if new_c.len() < text.len() {
                    saved += text.len() - new_c.len();
                    modified = true;
                    touched += 1;
                    msg["content"] = serde_json::Value::String(new_c);
                }
            }
            continue;
        }
        // Anthropic format: type:"tool_result" blocks inside user messages.
        let Some(blocks) = msg.get_mut("content").and_then(|c| c.as_array_mut()) else {
            continue;
        };
        for block in blocks.iter_mut() {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                continue;
            }
            let tool_use_id = block
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let Some(content) = block.get("content") else {
                continue;
            };
            let text = content_to_text(content);
            original += text.len();
            let replacement = match slim_action(&text, cfg) {
                Some(SlimAction::Placeholder) => {
                    Some(placeholder(&text, tool_use_id.as_deref(), text.len()))
                }
                Some(SlimAction::Cap(capped)) => Some(capped),
                None => None,
            };
            if let Some(new_c) = replacement {
                if new_c.len() < text.len() {
                    saved += text.len() - new_c.len();
                    modified = true;
                    touched += 1;
                    block["content"] = serde_json::Value::String(new_c);
                }
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
        max_tool_chars,
        placeholder_after: max_tool_chars.saturating_mul(4),
    };
    slim_tool_messages(body, &cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_cfg() -> SlimConfig {
        SlimConfig {
            max_tool_chars: 200,
            placeholder_after: 8_000,
        }
    }

    #[test]
    fn oversized_tools_are_capped_regardless_of_position() {
        let ancient = "ANCIENT".repeat(500);
        let mid = "MID".repeat(500);
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
        let out = slim_tool_messages(body, &small_cfg());
        assert!(out.modified);
        assert!(out.slimmed_chars > 0);
        let msgs = out.body["messages"].as_array().unwrap();
        // Content-only rules: every oversized body is capped, position-independent.
        assert!(msgs[1]["content"].as_str().unwrap().contains("truncated"));
        assert!(msgs[2]["content"].as_str().unwrap().contains("truncated"));
        // Small newest body is untouched.
        assert_eq!(msgs[3]["content"].as_str().unwrap(), newest);
        assert_eq!(msgs[1]["tool_call_id"], "c0");
        assert_eq!(msgs[3]["tool_call_id"], "c2");
    }

    #[test]
    fn huge_bodies_collapse_to_placeholder() {
        let huge = "HUGE".repeat(10_000);
        let body = serde_json::json!({
            "messages": [
                {"role":"tool","tool_call_id":"c0","content": huge}
            ]
        });
        let out = slim_tool_messages(body, &small_cfg());
        let content = out.body["messages"][0]["content"].as_str().unwrap();
        assert!(content.contains("omitted"));
        assert!(content.contains("id=c0"));
        assert!(out.slimmed_chars > 0);
    }

    #[test]
    fn anthropic_tool_result_blocks_are_trimmed_in_place() {
        let huge = "DATA".repeat(500);
        let body = serde_json::json!({
            "messages": [
                {"role":"user","content":[
                    {"type":"tool_result","tool_use_id":"toolu_1","content": huge}
                ]}
            ]
        });
        let out = slim_tool_messages(body, &small_cfg());
        let block = &out.body["messages"][0]["content"][0];
        assert_eq!(block["type"], "tool_result");
        assert_eq!(block["tool_use_id"], "toolu_1");
        let trimmed = block["content"].as_str().unwrap();
        assert!(trimmed.contains("truncated"));
        assert!(trimmed.len() < huge.len());
    }

    #[test]
    fn unchanged_messages_render_identically_across_turns() {
        // Cache-stability contract: the same message must render the same way
        // no matter how many newer tool messages arrive in later turns.
        let old_body = "OLD".repeat(2_000);
        let new_body = "NEW".repeat(2_000);
        let cfg = small_cfg();

        let turn_one = serde_json::json!({
            "messages": [
                {"role":"user","content":"work"},
                {"role":"tool","tool_call_id":"c0","content": old_body}
            ]
        });
        let turn_two = serde_json::json!({
            "messages": [
                {"role":"user","content":"work"},
                {"role":"tool","tool_call_id":"c0","content": old_body},
                {"role":"assistant","content":[{"type":"text","text":"done"}]},
                {"role":"tool","tool_call_id":"c1","content": new_body}
            ]
        });

        let one = slim_tool_messages(turn_one, &cfg);
        let two = slim_tool_messages(turn_two, &cfg);
        let m1 = &one.body["messages"][1]["content"];
        let m2_old = &two.body["messages"][1]["content"];
        assert_eq!(m1, m2_old, "old tool must not be re-rendered as history grows");
    }

    #[test]
    fn no_tools_noop() {
        let body = serde_json::json!({
            "messages": [{"role":"user","content":"hi"}]
        });
        let out = slim_tool_messages(body, &small_cfg());
        assert!(!out.modified);
    }
}
