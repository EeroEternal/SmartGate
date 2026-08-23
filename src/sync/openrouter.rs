use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct OpenRouterApiResponse {
    data: Vec<OpenRouterApiModel>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterApiModel {
    id: String,
    name: Option<String>,
    created: Option<i64>,
    description: Option<String>,
    context_length: Option<i64>,
    pricing: Option<OpenRouterPricing>,
    top_provider: Option<OpenRouterTopProvider>,
    architecture: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OpenRouterPricing {
    prompt: Option<String>,
    completion: Option<String>,
    request: Option<String>,
    image: Option<String>,
    discount: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OpenRouterTopProvider {
    context_length: Option<i64>,
    max_completion_tokens: Option<i64>,
    is_moderated: Option<bool>,
}

/// Helper to parse pricing string (which is price per 1 token) into price per 1M tokens.
fn parse_price_per_1m(s: Option<&String>) -> f64 {
    match s {
        Some(val) => val.parse::<f64>().unwrap_or(0.0) * 1_000_000.0,
        None => 0.0,
    }
}

/// Syncs the public OpenRouter models catalog and saves it into the database.
pub async fn sync_openrouter_market(db: &PgPool) -> anyhow::Result<usize> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let resp = client
        .get("https://openrouter.ai/api/v1/models")
        .header("HTTP-Referer", "https://smartgate.run")
        .header("X-Title", "SmartGate Market Radar")
        .send()
        .await?;

    if !resp.status().is_success() {
        anyhow::bail!("Failed to fetch OpenRouter models: HTTP {}", resp.status());
    }

    let api_data: OpenRouterApiResponse = resp.json().await?;
    let mut count = 0;

    for model in api_data.data {
        let name = model.name.unwrap_or_else(|| model.id.clone());
        let context_length = model.context_length.unwrap_or(0).clamp(0, i32::MAX as i64) as i32;
        
        let prompt_price_per_1m = parse_price_per_1m(model.pricing.as_ref().and_then(|p| p.prompt.as_ref()));
        let completion_price_per_1m = parse_price_per_1m(model.pricing.as_ref().and_then(|p| p.completion.as_ref()));
        let request_price = model.pricing.as_ref().and_then(|p| p.request.as_ref()).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        let image_price = model.pricing.as_ref().and_then(|p| p.image.as_ref()).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        let discount_ratio = model.pricing.as_ref().and_then(|p| p.discount).unwrap_or(0.0);

        let is_free = if model.id.ends_with(":free") || (prompt_price_per_1m <= 0.0 && completion_price_per_1m <= 0.0) {
            1
        } else {
            0
        };

        let (top_ctx, top_max_tokens, top_mod) = match &model.top_provider {
            Some(tp) => (
                tp.context_length.map(|v| v.clamp(0, i32::MAX as i64) as i32),
                tp.max_completion_tokens.map(|v| v.clamp(0, i32::MAX as i64) as i32),
                tp.is_moderated.map(|b| if b { 1 } else { 0 }).unwrap_or(0),
            ),
            None => (None, None, 0),
        };

        let raw_pricing_json = model.pricing.as_ref().and_then(|p| serde_json::to_string(p).ok());
        let architecture_json = model.architecture.as_ref().and_then(|a| serde_json::to_string(a).ok());

        sqlx::query(
            "INSERT INTO openrouter_market_models (
                id, name, created_at, description, context_length,
                prompt_price_per_1m, completion_price_per_1m, request_price, image_price,
                discount_ratio, is_free, top_provider_context_length, top_provider_max_completion_tokens,
                top_provider_is_moderated, raw_pricing_json, architecture_json, synced_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                created_at = EXCLUDED.created_at,
                description = EXCLUDED.description,
                context_length = EXCLUDED.context_length,
                prompt_price_per_1m = EXCLUDED.prompt_price_per_1m,
                completion_price_per_1m = EXCLUDED.completion_price_per_1m,
                request_price = EXCLUDED.request_price,
                image_price = EXCLUDED.image_price,
                discount_ratio = EXCLUDED.discount_ratio,
                is_free = EXCLUDED.is_free,
                top_provider_context_length = EXCLUDED.top_provider_context_length,
                top_provider_max_completion_tokens = EXCLUDED.top_provider_max_completion_tokens,
                top_provider_is_moderated = EXCLUDED.top_provider_is_moderated,
                raw_pricing_json = EXCLUDED.raw_pricing_json,
                architecture_json = EXCLUDED.architecture_json,
                synced_at = CURRENT_TIMESTAMP",
        )
        .bind(&model.id)
        .bind(&name)
        .bind(model.created)
        .bind(&model.description)
        .bind(context_length)
        .bind(prompt_price_per_1m)
        .bind(completion_price_per_1m)
        .bind(request_price)
        .bind(image_price)
        .bind(discount_ratio)
        .bind(is_free)
        .bind(top_ctx)
        .bind(top_max_tokens)
        .bind(top_mod)
        .bind(&raw_pricing_json)
        .bind(&architecture_json)
        .execute(db)
        .await?;

        count += 1;
    }

    tracing::info!(target: "smartgate.openrouter", count, "synced OpenRouter market models");
    Ok(count)
}

/// Spawns a background task that periodically syncs OpenRouter market models (e.g. every 6 hours).
pub fn spawn_openrouter_sync_worker(db: PgPool, interval: Duration) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            if let Err(e) = sync_openrouter_market(&db).await {
                tracing::warn!(target: "smartgate.openrouter", error = %e, "failed to sync OpenRouter market models");
            }
        }
    });
}
