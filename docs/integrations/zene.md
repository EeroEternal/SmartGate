# Zene inference gateway integration

Zene (and other upstream-compatible gateways) can probe SmartGate at startup instead of guessing from URL or `ZENE_UPSTREAM_KIND`.

## Capabilities probe

```http
GET /v1/zene/capabilities
```

No authentication required. Example response:

```json
{
  "gateway": "smartgate",
  "version": "0.2.0",
  "features": [
    "warming",
    "session_id",
    "context_epoch",
    "prefix_hash",
    "context_delivery"
  ]
}
```

| Field | Meaning |
|-------|---------|
| `gateway` | Must be `"smartgate"` to enable SmartGate-specific header mapping |
| `version` | SmartGate release version (`CARGO_PKG_VERSION`) |
| `features` | Opt-in control-plane features the client may inject |

Recommended Zene logic:

1. On startup (or before first forward), `GET {upstream_base}/v1/zene/capabilities`.
2. If HTTP 200 and `gateway == "smartgate"` → enable `X-SmartGate-*` injection.
3. Otherwise → treat upstream as plain OpenAI-compatible; no SmartGate headers.

Until this probe is wired on the Zene side, keep using `ZENE_UPSTREAM_KIND=smartgate` or URL heuristics as fallback.

## Related headers

See [harness.md](./harness.md#session-id-warming-observability) for `X-SmartGate-Session-Id`, `X-SmartGate-Context-Epoch`, and related warming fields.

## Health

`GET /health` and `GET /healthz` both return `OK` for liveness checks; they do not advertise gateway identity or features.
