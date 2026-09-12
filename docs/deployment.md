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
| `RESEND_API_KEY` | Resend API key stored as a Railway secret |
| `RESEND_FROM_EMAIL` | A sender address on a verified Resend domain |
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

Never put the admin token in a `VITE_*` variable: Vite inlines those into the public JavaScript bundle. The operator enters the token at runtime in the console's sign-in form and it is kept in `sessionStorage` for that tab only.

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

The operations console at `/admin` authenticates with the API's `ADMIN_TOKEN`. Open the console and paste the token into the sign-in form: it is stored in `sessionStorage` for that tab and sent as `Authorization: Bearer <token>` to `/api/admin/*`. No token is compiled into the frontend bundle, and a rejected token is discarded so the form is shown again.

Because the token still travels from the browser, treat the console as an operator surface:

- keep `ADMIN_TOKEN` long and random, and rotate it when an operator leaves;
- restrict who can reach `/admin` on the frontend origin if the deployment is public;
- a future iteration can replace the shared token with a per-user admin session, which would make the console auditable per operator.

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
