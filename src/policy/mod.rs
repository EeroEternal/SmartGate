//! Control-plane policy: tokens, budgets, context trim, route hints.

pub mod budget;
pub mod context;
pub mod route_hint;
pub mod session;
pub mod tokens;

pub use budget::{effective_daily_limit, evaluate as evaluate_budget, spent_today_for_key, BudgetOutcome};
pub use context::{slim_tool_messages, trim_tool_messages, SlimConfig, SlimResult};
pub use route_hint::{clear_hint, get_hint, set_hint, HintGuard, RouteHint};
pub use session::{
    computed_prefix_hash, extract_context_delivery, extract_context_epoch, extract_session_id,
    format_prefix_hash, get_sticky_endpoint, next_turn_index, prefix_stable, record_success,
    resolve_prefix_hash,
};
pub use tokens::{
    estimate_tokens_from_text, expected_output_tokens, extract_openai_prompt_text,
    heuristic_difficulty, request_has_tools, tool_message_chars,
};
