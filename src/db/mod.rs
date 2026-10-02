use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

pub async fn init_db(database_url: &str) -> anyhow::Result<PgPool> {
    let max_connections: u32 = std::env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);
    let acquire_timeout_secs: u64 = std::env::var("DB_ACQUIRE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(15);

    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(acquire_timeout_secs))
        .connect(database_url)
        .await?;

    // Run migrations with automatic self-healing for VersionMismatch checksum errors
    let migrator = sqlx::migrate!("./migrations");
    if let Err(e) = migrator.run(&pool).await {
        tracing::warn!("Migration error encountered: {e:?}");
        if let sqlx::migrate::MigrateError::VersionMismatch(version) = &e {
            tracing::warn!(
                "Detected VersionMismatch for migration {version}. Removing stale migration record to self-heal..."
            );
            if let Err(del_err) = sqlx::query("DELETE FROM _sqlx_migrations WHERE version = $1")
                .bind(version)
                .execute(&pool)
                .await
            {
                tracing::error!("Failed to remove stale migration record: {del_err}");
                return Err(e.into());
            }
            tracing::info!(
                "Stale migration record for version {version} removed. Retrying migration..."
            );
            migrator.run(&pool).await?;
        } else {
            return Err(e.into());
        }
    }

    Ok(pool)
}
