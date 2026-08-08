//! Control-plane policy: tokens, budgets, context trim, route hints.

pub mod budget;
pub mod context;
pub mod route_hint;
pub mod tokens;

pub use budget::{effective_daily_limit, evaluate as evaluate_budget, spent_today_for_key, BudgetOutcome};
pub use context::{slim_tool_messages, trim_tool_messages, SlimConfig, SlimResult};
pub use route_hint::{clear_hint, get_hint, set_hint, HintGuard, RouteHint};
pub use tokens::{
    estimate_tokens_from_text, expected_output_tokens, extract_openai_prompt_text,
    heuristic_difficulty, request_has_tools, tool_message_chars,
};
