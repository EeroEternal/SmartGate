//! SaaS user authentication: registration, email verification, login, and sessions.

use axum::{
    extract::State,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::{api::models::ApiResponse, auth::hash_token, config::AppState};

use super::{conflict_error, db_error, is_unique_violation, SaasContext, SaasUser, SESSION_COOKIE};

const SESSION_DAYS: i64 = 30;
const VERIFICATION_CODE_TTL_MINUTES: i64 = 10;
const VERIFICATION_RESEND_SECONDS: i64 = 60;
const VERIFICATION_MAX_ATTEMPTS: i32 = 5;

#[derive(Debug, Deserialize)]
pub(super) struct RegisterRequest {
    email: String,
    password: String,
    verification_code: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct VerificationCodeRequest {
    email: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct UpdateProfileRequest {
    current_password: String,
    email: Option<String>,
    new_password: Option<String>,
}

pub(super) async fn register(
    State(state): State<Arc<AppState>>,
    Json(input): Json<RegisterRequest>,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    let email = normalize_email(&input.email);
    validate_credentials(&email, &input.password)?;
    validate_verification_code(&input.verification_code)?;
    let password_hash = hash_password(&input.password);
    let user_id = Uuid::new_v4().to_string();
    let org_id = Uuid::new_v4().to_string();
    let project_id = Uuid::new_v4().to_string();

    let mut tx = state.db.begin().await.map_err(db_error)?;
    let verification: Option<(String, i32, chrono::DateTime<Utc>, Option<chrono::DateTime<Utc>>)> =
        sqlx::query_as(
            "SELECT code_hash, attempts, expires_at, used_at
             FROM saas_email_verifications WHERE email = $1 FOR UPDATE",
        )
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
    let Some((code_hash, attempts, expires_at, used_at)) = verification else {
        return Err(verification_error("Request a verification code first"));
    };
    if used_at.is_some() || expires_at <= Utc::now() || attempts >= VERIFICATION_MAX_ATTEMPTS {
        return Err(verification_error("The verification code is invalid or expired"));
    }
    if code_hash != verification_code_hash(&email, &input.verification_code) {
        sqlx::query("UPDATE saas_email_verifications SET attempts = attempts + 1 WHERE email = $1")
            .bind(&email)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        return Err(verification_error("The verification code is invalid or expired"));
    }
    sqlx::query("UPDATE saas_email_verifications SET used_at = CURRENT_TIMESTAMP WHERE email = $1")
        .bind(&email)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("INSERT INTO saas_users (id, email, password_hash) VALUES ($1, $2, $3)")
        .bind(&user_id)
        .bind(&email)
        .bind(password_hash)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if let sqlx::Error::Database(database_error) = &error {
                if database_error.constraint() == Some("saas_users_email_key") {
                    return conflict_error("Email is already registered");
                }
            }
            db_error(error)
        })?;
    sqlx::query("INSERT INTO orgs (id, name, description) VALUES ($1, $2, $3)")
        .bind(&org_id)
        .bind(format!("{}'s workspace", email))
        .bind("Personal SmartGate workspace")
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("INSERT INTO projects (id, org_id, name, description) VALUES ($1, $2, $3, $4)")
        .bind(&project_id)
        .bind(&org_id)
        .bind("Personal project")
        .bind("Default personal project")
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')")
        .bind(&org_id)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    let token = create_session(&state.db, &user_id)
        .await
        .map_err(db_error)?;
    Ok(session_response(
        json!({"email": email, "workspace": "Personal workspace"}),
        token,
        StatusCode::CREATED,
    ))
}

pub(super) async fn send_verification_code(
    State(state): State<Arc<AppState>>,
    Json(input): Json<VerificationCodeRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let email = normalize_email(&input.email);
    validate_email(&email)?;

    let already_registered: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM saas_users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    if already_registered.is_some() {
        return Ok(Json(ApiResponse::success(json!({"sent": true}))));
    }

    let recent: Option<(chrono::DateTime<Utc>,)> = sqlx::query_as(
        "SELECT sent_at FROM saas_email_verifications
         WHERE email = $1 AND used_at IS NULL",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    if let Some((sent_at,)) = recent {
        let elapsed = (Utc::now() - sent_at).num_seconds();
        if elapsed < VERIFICATION_RESEND_SECONDS {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(ApiResponse::error("Please wait before requesting another code")),
            ));
        }
    }

    let (Some(api_key), Some(from_email)) = (
        state.config.resend_api_key.as_deref(),
        state.config.resend_from_email.as_deref(),
    ) else {
        tracing::error!("Email verification is not configured");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiResponse::error("Email verification is not configured")),
        ));
    };

    let code = format!("{:06}", (Uuid::new_v4().as_u128() % 1_000_000) as u32);
    let response = reqwest::Client::new()
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key)
        .json(&json!({
            "from": from_email,
            "to": [email],
            "subject": "Your SmartGate verification code",
            "html": format!("<p>Your SmartGate verification code is <strong>{code}</strong>.</p><p>This code expires in {VERIFICATION_CODE_TTL_MINUTES} minutes.</p>"),
        }))
        .send()
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "Failed to send verification email");
            email_service_error()
        })?;
    if !response.status().is_success() {
        tracing::error!(status = %response.status(), "Resend rejected verification email");
        return Err(email_service_error());
    }

    sqlx::query(
        "INSERT INTO saas_email_verifications (email, code_hash, attempts, sent_at, expires_at, used_at)
         VALUES ($1, $2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'), NULL)
         ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash,
           attempts = 0, sent_at = EXCLUDED.sent_at, expires_at = EXCLUDED.expires_at, used_at = NULL",
    )
    .bind(&email)
    .bind(verification_code_hash(&email, &code))
    .bind(VERIFICATION_CODE_TTL_MINUTES)
    .execute(&state.db)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::success(json!({"sent": true}))))
}

pub(super) async fn login(
    State(state): State<Arc<AppState>>,
    Json(input): Json<LoginRequest>,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    let email = normalize_email(&input.email);
    let user = sqlx::query_as::<_, SaasUser>(
        "SELECT id, email, password_hash, status FROM saas_users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?
    .filter(|user| {
        user.status == "active" && verify_password(&input.password, &user.password_hash)
    });
    let Some(user) = user else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::error("Invalid email or password")),
        ));
    };
    sqlx::query("UPDATE saas_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(db_error)?;
    let token = create_session(&state.db, &user.id)
        .await
        .map_err(db_error)?;
    Ok(session_response(
        json!({"email": user.email, "workspace": "Personal workspace"}),
        token,
        StatusCode::OK,
    ))
}

pub(super) async fn logout(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    if let Some(token) = cookie_value(&headers, SESSION_COOKIE) {
        sqlx::query(
            "UPDATE saas_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1",
        )
        .bind(hash_token(&token))
        .execute(&state.db)
        .await
        .map_err(db_error)?;
    }
    let mut response = Json(ApiResponse::success(json!({"logged_out": true}))).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("smartgate_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"),
    );
    Ok(response)
}

pub(super) async fn me(ctx: SaasContext) -> Json<ApiResponse<Value>> {
    Json(ApiResponse::success(json!({
        "id": ctx.user.id,
        "email": ctx.user.email,
        "org_id": ctx.org_id,
        "project_id": ctx.project_id,
    })))
}

pub(super) async fn update_profile(
    State(state): State<Arc<AppState>>,
    ctx: SaasContext,
    Json(input): Json<UpdateProfileRequest>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    if input.email.is_none() && input.new_password.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Provide an email or a new password to update")),
        ));
    }
    if !verify_password(&input.current_password, &ctx.user.password_hash) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::error("Current password is incorrect")),
        ));
    }

    let email = input.email.map(|value| normalize_email(&value));
    if let Some(email) = &email {
        validate_email(email)?;
    }
    if let Some(password) = &input.new_password {
        if password.len() < 10 || password.len() > 256 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error("New password must be 10-256 characters")),
            ));
        }
    }

    let password_hash = input.new_password.as_deref().map(hash_password);
    match (email.as_deref(), password_hash.as_deref()) {
        (Some(email), Some(password_hash)) => sqlx::query(
            "UPDATE saas_users SET email = $1, password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        )
        .bind(email)
        .bind(password_hash)
        .bind(&ctx.user.id)
        .execute(&state.db)
        .await
        .map_err(|error| {
            if is_unique_violation(&error) {
                conflict_error("Email is already registered")
            } else {
                db_error(error)
            }
        })?,
        (Some(email), None) => sqlx::query(
            "UPDATE saas_users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(email)
        .bind(&ctx.user.id)
        .execute(&state.db)
        .await
        .map_err(|error| {
            if is_unique_violation(&error) {
                conflict_error("Email is already registered")
            } else {
                db_error(error)
            }
        })?,
        (None, Some(password_hash)) => sqlx::query(
            "UPDATE saas_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(password_hash)
        .bind(&ctx.user.id)
        .execute(&state.db)
        .await
        .map_err(db_error)?,
        (None, None) => unreachable!("empty profile update was rejected above"),
    };

    Ok(Json(ApiResponse::success(json!({
        "id": ctx.user.id,
        "email": email.unwrap_or(ctx.user.email),
    }))))
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn validate_email(email: &str) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    let valid = email.len() <= 254
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && !domain.is_empty() && !domain.starts_with('.') && !domain.ends_with('.')
        });
    if !valid {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Use a valid email address")),
        ));
    }
    Ok(())
}

fn validate_credentials(
    email: &str,
    password: &str,
) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    validate_email(email)?;
    if password.len() < 10 || password.len() > 256 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "Use a valid email and a password of 10-256 characters",
            )),
        ));
    }
    Ok(())
}

fn validate_verification_code(
    code: &str,
) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(verification_error("Enter the 6-digit verification code"));
    }
    Ok(())
}

fn verification_code_hash(email: &str, code: &str) -> String {
    hash_token(&format!("smartgate-email-verification-v1:{email}:{code}"))
}

fn verification_error(message: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (StatusCode::BAD_REQUEST, Json(ApiResponse::error(message)))
}

fn email_service_error() -> (StatusCode, Json<ApiResponse<()>>) {
    (
        StatusCode::BAD_GATEWAY,
        Json(ApiResponse::error("Unable to send the verification email")),
    )
}

fn hash_password(password: &str) -> String {
    let salt = Uuid::new_v4().simple().to_string();
    format!("sha256${}${}", salt, password_digest(password, &salt))
}

fn verify_password(password: &str, stored: &str) -> bool {
    let mut parts = stored.split('$');
    matches!((parts.next(), parts.next(), parts.next()), (Some("sha256"), Some(salt), Some(digest)) if password_digest(password, salt) == digest)
}

fn password_digest(password: &str, salt: &str) -> String {
    hash_token(&format!("smartgate-password-v1:{salt}:{password}"))
}

async fn create_session(db: &PgPool, user_id: &str) -> Result<String, sqlx::Error> {
    let token = format!("sgs_{}", Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO saas_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(hash_token(&token))
    .bind(Utc::now() + Duration::days(SESSION_DAYS))
    .execute(db)
    .await?;
    Ok(token)
}

fn session_response(data: Value, token: String, status: StatusCode) -> Response {
    let mut response = (status, Json(ApiResponse::success(data))).into_response();
    let secure = std::env::var("COOKIE_SECURE")
        .map(|value| value != "0")
        .unwrap_or(false);
    let cookie = format!(
        "{SESSION_COOKIE}={token}; Max-Age={}; Path=/; HttpOnly; SameSite=Lax{}",
        SESSION_DAYS * 24 * 60 * 60,
        if secure { "; Secure" } else { "" }
    );
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

fn cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == name).then(|| value.to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::{validate_verification_code, verification_code_hash};

    #[test]
    fn verification_code_hash_is_bound_to_email() {
        assert_eq!(
            verification_code_hash("user@example.com", "123456"),
            verification_code_hash("user@example.com", "123456")
        );
        assert_ne!(
            verification_code_hash("user@example.com", "123456"),
            verification_code_hash("other@example.com", "123456")
        );
    }

    #[test]
    fn verification_code_requires_six_digits() {
        assert!(validate_verification_code("123456").is_ok());
        assert!(validate_verification_code("12345").is_err());
        assert!(validate_verification_code("12345a").is_err());
    }
}
