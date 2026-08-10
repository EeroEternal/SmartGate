# Codex + XGate

Use Codex GUI with an XGate model service as the backend. XGate provides the OpenAI-compatible gateway endpoint, while Codex remains responsible for the local coding-agent experience.

## Before you start

1. Create a model service in XGate and connect one or more providers.
2. Create a project API key and authorize the model service for that key.
3. Choose the XGate model service name that Codex should request, such as `fusion`.
4. Use the XGate API base URL for your deployment. The examples below use `https://api.xgate.sh/v1`; replace it with your own URL when self-hosting.

## Recommended file layout

Codex 0.134.0 and newer can load a Profile from a separate file. Keep the base configuration independent from the Fusion model catalog:

```text
~/.codex/
├── config.toml
├── fusion.config.toml
└── models.json
```

Do not commit `fusion.config.toml` if it contains a bearer token. Restrict its permissions on macOS/Linux, for example with `chmod 600 ~/.codex/fusion.config.toml`.

## `fusion.config.toml`

```toml
model = "fusion"
model_provider = "xgate"
preferred_auth_method = "apikey"
model_reasoning_effort = "high"
model_catalog_json = "/Users/you/.codex/models.json"

[model_providers.xgate]
name = "XGate"
base_url = "https://api.xgate.sh/v1"
wire_api = "chat_completions"
experimental_bearer_token = "<project API key>"
```

Replace the path, base URL, model name, and API key with values from your XGate workspace. The `experimental_bearer_token` value is the actual key. If you use an environment-variable-based authentication option supported by your Codex version, configure `env_key` with the **variable name**, not the key value itself.

`wire_api = "chat_completions"` is important for XGate deployments that do not accept the Responses API `thinking_budget` parameter.

## `models.json`

The catalog must use reasoning-level objects, not strings, and must include the fields expected by the Codex version in use:

```json
{
  "models": [
    {
      "slug": "fusion",
      "display_name": "Fusion (XGate)",
      "context_window": 128000,
      "max_context_window": 128000,
      "default_reasoning_level": "high",
      "supported_reasoning_levels": [
        {"effort": "low", "description": "Low reasoning effort"},
        {"effort": "high", "description": "High reasoning effort"},
        {"effort": "max", "description": "Maximum reasoning effort"}
      ],
      "supports_parallel_tool_calls": true,
      "support_verbosity": true,
      "default_verbosity": "low",
      "input_modalities": ["text"],
      "shell_type": "shell_command",
      "visibility": "list",
      "supported_in_api": true,
      "priority": 1,
      "truncation_policy": {"mode": "tokens", "limit": 10000},
      "tool_mode": "code_mode_only",
      "apply_patch_tool_type": "freeform",
      "experimental_supported_tools": [],
      "base_instructions": "You are a helpful coding assistant."
    }
  ]
}
```

Keep the catalog model `slug` aligned with the `model` value in the Profile and with the model service name authorized for the XGate API key.

## Start Codex

Use the separate Profile explicitly:

```bash
/Applications/Codex.app/Contents/MacOS/ChatGPT --profile fusion
```

A small launcher can invoke the same command if you prefer to start Codex from Finder. Restart Codex after changing `config.toml`, `fusion.config.toml`, or `models.json`.

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | The credential is invalid, or `env_key` contains the key rather than an environment-variable name. | Use the correct project API key, or set `env_key` to the variable name. |
| `expected struct ReasoningEffortPreset` | `supported_reasoning_levels` contains strings. | Use `{ "effort": ..., "description": ... }` objects. |
| `missing field shell_type` or `support_verbosity` | The model catalog is missing Codex-required metadata. | Add the required catalog fields for your Codex version. |
| `thinking_budget ... positive integer` | The upstream does not support the Responses API parameter. | Set `wire_api = "chat_completions"`. |
| `AbsolutePathBuf deserialized without a base path` | Codex GUI loads an absolute catalog path from the main configuration context. | Keep `model_catalog_json` in the separate Profile and launch with `--profile fusion`. |
| `legacy profile = "fusion" config is no longer supported` | Newer Codex versions no longer support the legacy inline profile syntax. | Use a standalone Profile file and `--profile fusion`. |

Codex configuration formats can change between releases. If a field is rejected, compare the catalog schema and Profile format with the Codex version installed before changing the XGate endpoint.
