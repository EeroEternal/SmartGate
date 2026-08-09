# Railway + Cloudflare Pages deployment

> Deployment connectivity check: this document is intentionally updated through the `main` branch so Railway auto-deploy can be verified. The API service source is the repository root.

SmartGate runs as a Rust/Axum service on Railway. The React frontend runs on Cloudflare Pages. PostgreSQL is provided by a Railway PostgreSQL service.

```text
Cloudflare Pages (web/)
        │ HTTPS + VITE_API_BASE_URL
        ▼
Railway API (Dockerfile)
        │ DATABASE_URL
        ▼
Railway PostgreSQL
```

## 1. Railway PostgreSQL

1. Create a Railway project.
2. Add a PostgreSQL service.
3. Wait until the database is healthy.
4. Do not copy the database password into source code or Git. Use Railway's generated `DATABASE_URL` reference variable.

## 2. Railway API service

Create a service from the GitHub repository and deploy the `main` branch. Railway detects the root `Dockerfile`.

Set these variables in the API service's **Variables** page. Use **Add Reference** for the PostgreSQL URL:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `ADMIN_TOKEN` | Generate a long random value in Railway Secrets |
| `CORS_ALLOWED_ORIGIN` | `https://app.example.com` |
| `COOKIE_SECURE` | `1` |
| `RUST_LOG` | `smartgate=info,tower_http=info` |

Railway provides `PORT` automatically. Do not hard-code it. SmartGate listens on `0.0.0.0:$PORT` when `ADDR` is not set.

After deployment, check:

```text
https://<railway-api-domain>/health
```

The response should be `OK`.

Generate a Railway public domain from the API service's **Settings → Networking → Public Networking**, or attach a custom `api.example.com` domain there.

## 3. Cloudflare Pages

Create a Pages project from the same repository with these build settings:

| Setting | Value |
|---|---|
| Root directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `20` or newer |

Set this Pages environment variable for both Preview and Production as appropriate:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://api.example.com` |

Do not set `VITE_ADMIN_TOKEN` in a public Pages build. Vite variables are embedded into browser JavaScript. Admin authentication must remain a backend secret.

## 4. Custom domains

Recommended domains:

```text
app.example.com → Cloudflare Pages
api.example.com → Railway API custom domain
```

Add `app.example.com` to Cloudflare Pages and `api.example.com` to Railway. Set `CORS_ALLOWED_ORIGIN=https://app.example.com` exactly, without a trailing slash.

## 5. Provider credentials

Provider API keys are not deployment variables. Add them only through the SmartGate SaaS model-service form or Admin API after the API is running. Never put provider keys in Git, frontend variables, Dockerfiles, build logs, or chat messages.

## 6. Admin access

The current Admin UI uses `VITE_ADMIN_TOKEN` for compatibility, which is not safe for a public production build because it becomes browser-visible. For the first deployment, keep Admin Console access restricted and do not expose an Admin token through Cloudflare Pages. Before public production use, move Admin authentication to a server-side session or a separately protected admin origin.

## 7. First smoke test

1. Open `https://app.example.com/register`.
2. Register a test account.
3. Create a model service with a provider URL and key.
4. Create an API key and copy it once.
5. Verify `/app/usage` and `/app/savings` load.
6. Send an OpenAI-compatible request to:

```text
https://api.example.com/v1/chat/completions
```

with the generated project API key.

No secret values belong in this document.
