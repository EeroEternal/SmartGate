use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use std::str::FromStr;
use std::time::Duration;

pub async fn init_db(database_url: &str) -> anyhow::Result<SqlitePool> {
    let trimmed = database_url.trim();
    let effective_url = if trimmed.is_empty()
        || trimmed.starts_with("postgres://")
        || trimmed.starts_with("postgresql://")
    {
        if !trimmed.is_empty() {
            tracing::warn!(
                "Legacy PostgreSQL DATABASE_URL detected; switching to local SQLite database sqlite://smartgate.db?mode=rwc"
            );
        }
        "sqlite://smartgate.db?mode=rwc"
    } else {
        trimmed
    };

    // Ensure parent directory exists for file-backed SQLite URLs
    if let Some(path_part) = effective_url.strip_prefix("sqlite://") {
        let file_path = path_part.split('?').next().unwrap_or(path_part);
        if file_path != ":memory:" && !file_path.is_empty() {
            if let Some(parent) = std::path::Path::new(file_path).parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = std::fs::create_dir_all(parent);
                }
            }
        }
    }

    let max_connections: u32 = std::env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(16);

    let connect_options = SqliteConnectOptions::from_str(effective_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10))
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(15))
        .connect_with(connect_options)
        .await?;

    let migrator = sqlx::migrate!("./migrations");
    if let Err(e) = migrator.run(&pool).await {
        tracing::warn!("Migration error encountered: {e:?}");
        if let sqlx::migrate::MigrateError::VersionMismatch(version) = &e {
            tracing::warn!(
                "Detected VersionMismatch for migration {version}. Removing stale migration record to self-heal..."
            );
            let _ = sqlx::query("DELETE FROM _sqlx_migrations WHERE version = $1")
                .bind(version)
                .execute(&pool)
                .await;
            migrator.run(&pool).await?;
        } else {
            return Err(e.into());
        }
    }

    Ok(pool)
}
