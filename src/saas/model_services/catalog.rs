//! Model catalog: static provider offerings plus live OpenRouter market models.

use axum::{extract::State, Json};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::{api::models::ApiResponse, config::AppState, saas::SaasContext};

pub(crate) async fn list_model_catalog(
    State(state): State<Arc<AppState>>,
    _ctx: SaasContext,
) -> Json<ApiResponse<Value>> {
    let mut offerings = Vec::new();
    let mut grouped: BTreeMap<String, (String, Vec<Value>)> = BTreeMap::new();

    for offering in eero_llm_providers::list_offerings()
        .into_iter()
        .filter(|offering| offering.model.deprecated_at.is_none())
    {
        let provider_id = offering.provider_id.to_string();
        let provider_name = eero_llm_providers::get_providers_data()
            .get(offering.provider_id)
            .map(|provider| provider.label)
            .unwrap_or(offering.provider_id)
            .to_string();
        let model = json!({
            "provider_id": offering.provider_id,
            "provider_name": provider_name,
            "endpoint_id": offering.endpoint_id,
            "endpoint_key": offering.endpoint_key,
            "region": offering.region,
            "base_url": offering.base_url,
            "price_currency": offering.price_currency,
            "model": offering.model.id,
            "model_name": offering.model.name,
            "description": offering.model.description,
            "input_price_per_1m": offering.model.input_price,
            "output_price_per_1m": offering.model.output_price,
            "cache_read_price_per_1m": offering.model.cache_read_price,
            "cache_write_price_per_1m": offering.model.cache_write_price,
            "supports_tools": offering.model.supports_tools,
            "supports_vision": offering.model.supports_vision,
            "supports_reasoning": offering.model.supports_reasoning,
            "context_length": offering.model.context_length,
        });
        offerings.push(model.clone());
        grouped
            .entry(provider_id)
            .or_insert_with(|| (provider_name, Vec::new()))
            .1
            .push(model);
    }

    // Also enrich with live OpenRouter market models from database
    if let Ok(or_models) = sqlx::query_as::<_, crate::models::OpenRouterMarketModel>(
        "SELECT * FROM openrouter_market_models ORDER BY prompt_price_per_1m ASC, name ASC",
    )
    .fetch_all(&state.db)
    .await
    {
        if !or_models.is_empty() {
            let mut or_list = Vec::with_capacity(or_models.len());
            for m in or_models {
                let or_item = json!({
                    "provider_id": "openrouter",
                    "provider_name": "OpenRouter",
                    "endpoint_id": format!("openrouter-{}", m.id),
                    "endpoint_key": "openrouter",
                    "region": "global",
                    "base_url": "https://openrouter.ai/api/v1",
                    "price_currency": "USD",
                    "model": m.id,
                    "model_name": m.name,
                    "description": m.description,
                    "input_price_per_1m": m.prompt_price_per_1m,
                    "output_price_per_1m": m.completion_price_per_1m,
                    "cache_read_price_per_1m": 0.0,
                    "cache_write_price_per_1m": 0.0,
                    "supports_tools": true,
                    "supports_vision": m.image_price > 0.0,
                    "supports_reasoning": m.id.contains("r1") || m.id.contains("reasoning") || m.id.contains("o1") || m.id.contains("o3"),
                    "context_length": m.context_length,
                });
                offerings.push(or_item.clone());
                or_list.push(or_item);
            }
            grouped.insert(
                "openrouter".to_string(),
                ("OpenRouter".to_string(), or_list),
            );
        }
    }

    let providers = grouped
        .into_iter()
        .map(|(id, (name, models))| {
            json!({
                "id": id,
                "name": name,
                "model_count": models.len(),
                "models": models,
            })
        })
        .collect::<Vec<_>>();

    Json(ApiResponse::success(json!({
        "providers": providers,
        // Keep the flat form for existing clients while the UI uses the grouped form.
        "offerings": offerings,
        "registry_version": eero_llm_providers::registry_version(),
        "registry_updated_at": eero_llm_providers::registry_updated_at(),
    })))
}
