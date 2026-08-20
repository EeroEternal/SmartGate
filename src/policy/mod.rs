//! Control-plane policy: tokens, budgets, context trim, route hints.

/// Difficulty score at or above which a request is classified as high complexity.
pub const DIFFICULTY_HIGH_THRESHOLD: f64 = 0.55;
/// Difficulty score at or above which a request is classified as medium complexity.
pub const DIFFICULTY_MEDIUM_THRESHOLD: f64 = 0.35;
/// Lower bound of the ambiguous range that may invoke the auxiliary Judge.
pub const JUDGE_TRIGGER_MIN: f64 = 0.30;
/// Upper bound of the ambiguous range that may invoke the auxiliary Judge.
pub const JUDGE_TRIGGER_MAX: f64 = 0.65;
/// Maximum duration for one auxiliary Judge request, in milliseconds.
pub const JUDGE_TIMEOUT_MS: u64 = 250;

pub mod budget;
pub mod context;
pub mod route_hint;
pub mod session;
pub mod tokens;

pub use budget::{effective_daily_limit, evaluate as evaluate_budget, spent_today_for_key, BudgetOutcome};
pub use context::{slim_tool_messages, trim_tool_messages, SlimConfig, SlimResult};
pub use route_hint::{
    clear_hint, get_hint, get_task_hint, set_hint, HintGuard, RouteHint, TASK_ROUTE_HINT,
};
pub use session::{
    computed_prefix_hash, extract_context_delivery, extract_context_epoch, extract_session_id,
    format_prefix_hash, get_sticky_endpoint, next_turn_index, prefix_stable, record_success,
    resolve_prefix_hash,
};
pub use tokens::{
    estimate_tokens_from_text, expected_output_tokens, extract_complexity_signals,
    extract_openai_prompt_text, extract_user_prompt_preview, heuristic_difficulty,
    request_has_tools, tool_message_chars,
};
