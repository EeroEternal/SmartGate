//! Progressive spend budgets (visibility → soft gate → hard block).

use chrono::Utc;
use sqlx::PgPool;

#[derive(Debug, Clone)]
pub enum BudgetOutcome {
    Ok,
    /// Over soft threshold (default 80%); allow but warn / downshift.
    Soft {
        spent: f64,
        limit: f64,
    },
    /// Over hard limit; reject.
    Hard {
        spent: f64,
        limit: f64,
    },
}

impl BudgetOutcome {
    pub fn should_downshift(&self) -> bool {
        matches!(self, BudgetOutcome::Soft { .. })
    }

    pub fn is_blocked(&self) -> bool {
        matches!(self, BudgetOutcome::Hard { .. })
    }
}

/// Effective daily limit: tighter of key and project when both set.
pub fn effective_daily_limit(key_limit: Option<f64>, project_limit: Option<f64>) -> Option<f64> {
    match (key_limit, project_limit) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

pub async fn spent_today_for_key(db: &PgPool, key_id: &str) -> f64 {
    let start = Utc::now().date_naive().and_hms_opt(0, 0, 0).unwrap();
    let start = start.and_utc();
    let row: (Option<f64>,) = sqlx::query_as(
        "SELECT SUM(estimated_cost) FROM usage_logs WHERE key_id = $1 AND timestamp >= $2",
    )
    .bind(key_id)
    .bind(start)
    .fetch_one(db)
    .await
    .unwrap_or((Some(0.0),));
    row.0.unwrap_or(0.0)
}

pub fn evaluate(spent: f64, limit: Option<f64>) -> BudgetOutcome {
    let Some(limit) = limit.filter(|l| *l > 0.0) else {
        return BudgetOutcome::Ok;
    };
    if spent >= limit {
        BudgetOutcome::Hard { spent, limit }
    } else if spent >= limit * 0.8 {
        BudgetOutcome::Soft { spent, limit }
    } else {
        BudgetOutcome::Ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_thresholds_are_inclusive() {
        assert!(matches!(evaluate(7.99, Some(10.0)), BudgetOutcome::Ok));
        assert!(matches!(
            evaluate(8.0, Some(10.0)),
            BudgetOutcome::Soft { .. }
        ));
        assert!(matches!(
            evaluate(10.0, Some(10.0)),
            BudgetOutcome::Hard { .. }
        ));
        assert!(matches!(evaluate(10.0, None), BudgetOutcome::Ok));
    }

    #[test]
    fn effective_limit_uses_tighter_scope() {
        assert_eq!(effective_daily_limit(Some(5.0), Some(10.0)), Some(5.0));
        assert_eq!(effective_daily_limit(None, Some(10.0)), Some(10.0));
    }
}
