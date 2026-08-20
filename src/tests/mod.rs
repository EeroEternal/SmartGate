//! Cross-module regression tests for control-plane routing decisions.

mod capability_routing;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct JudgeEvalCase {
    id: String,
    category: String,
    label: String,
    prompt: String,
}

#[test]
fn offline_judge_eval_reports_heuristic_routing_metrics() {
    let cases = include_str!("fixtures/judge_eval.jsonl")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<JudgeEvalCase>(line).expect("valid Judge eval case"))
        .collect::<Vec<_>>();

    assert!(cases.len() >= 16);
    assert!(cases.iter().all(|case| !case.id.is_empty()));
    assert!(cases.iter().any(|case| case.category == "coding"));
    assert!(cases.iter().any(|case| case.category == "tools"));
    assert!(cases.iter().any(|case| case.category == "translation"));

    let mut correct = 0usize;
    let mut false_escalations = 0usize;
    let mut false_downshifts = 0usize;
    let mut judge_triggers = 0usize;

    for case in &cases {
        let body = serde_json::json!({
            "messages": [{"role": "user", "content": case.prompt}],
        });
        let difficulty = crate::policy::heuristic_difficulty(&body);
        let predicted_complex = difficulty >= crate::policy::DIFFICULTY_HIGH_THRESHOLD;
        let expected_complex = case.label == "complex";

        if (crate::policy::JUDGE_TRIGGER_MIN..=crate::policy::JUDGE_TRIGGER_MAX)
            .contains(&difficulty)
        {
            judge_triggers += 1;
        }
        if predicted_complex == expected_complex {
            correct += 1;
        } else if predicted_complex {
            false_escalations += 1;
        } else {
            false_downshifts += 1;
        }
    }

    let accuracy = correct as f64 / cases.len() as f64;
    eprintln!(
        "Judge offline eval: cases={}, accuracy={:.1}%, false_escalations={}, false_downshifts={}, judge_triggers={}",
        cases.len(),
        accuracy * 100.0,
        false_escalations,
        false_downshifts,
        judge_triggers,
    );

    assert!(correct > 0);
    assert!(false_escalations + false_downshifts < cases.len());
}
