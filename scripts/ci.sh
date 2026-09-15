#!/usr/bin/env bash
# Local equivalent of the GitHub Actions CI (see .github/workflows/ci.yml).
# Run from the repository root:
#
#     scripts/ci.sh
#
# Optional environment variables:
#   SMARTGATE_TEST_DATABASE_URL  a disposable PostgreSQL URL; when set, the DB-backed
#                                proxy pipeline test runs instead of being skipped.
#   REDIS_URL                    a Redis URL; when set, the ignored Redis warm
#                                integration test runs as well.
#
# Backend checks match CI's pinned Rust toolchain (1.92.0). A newer local toolchain
# may report additional clippy lints; install the pinned toolchain with
# `rustup toolchain install 1.92.0` to reproduce CI exactly.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- Backend ---
echo "==> cargo check --locked"
cargo check --locked

echo "==> cargo fmt --all -- --check"
cargo fmt --all -- --check

echo "==> cargo clippy --locked --all-targets -- -D warnings"
cargo clippy --locked --all-targets -- -D warnings

echo "==> cargo test --locked --lib"
if [ -n "${SMARTGATE_TEST_DATABASE_URL:-}" ]; then
    SMARTGATE_TEST_DATABASE_URL="$SMARTGATE_TEST_DATABASE_URL" cargo test --locked --lib
else
    echo "note: SMARTGATE_TEST_DATABASE_URL unset; the DB-backed proxy pipeline test will be skipped"
    cargo test --locked --lib
fi

if [ -n "${REDIS_URL:-}" ]; then
    echo "==> cargo test Redis warm integration (REDIS_URL set)"
    REDIS_URL="$REDIS_URL" cargo test --locked --lib redis_persists_virtual_model_binding_across_store_instances -- --ignored
else
    echo "note: REDIS_URL unset; skipping the Redis warm integration test"
fi

# --- Frontend ---
if [ -d web ]; then
    cd web

    echo "==> npm ci"
    npm ci

    echo "==> npm run lint"
    npm run lint

    echo "==> npm test"
    npm test

    echo "==> npm run build"
    npm run build

    cd ..
fi

echo "All local CI checks passed."
