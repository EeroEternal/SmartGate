# Zene Warm Inference Gateway Protocol

> Status: Warm MVP protocol baseline
>
> This document defines the target protocol for SmartGate to act as Zene's
> **Warm layer**. It distinguishes the fields and behaviors already compatible
> with the current Zene client from stricter follow-up requirements. It does not
> make SmartGate an Agent runtime.

## 1. Purpose and boundary

Zene remains the semantic owner of an Agent run:

- complete transcript and recovery state;
- compaction and memory decisions;
- pinned-context semantics;
- tool execution and tool-output handle management;
- deciding when the canonical context changes and `epoch` must advance.

SmartGate provides the execution-side Warm layer:

- store the latest canonical prefix published by Zene;
- assemble `prefix + delta` into a normal OpenAI-compatible request;
- validate session, epoch, prefix hash, and tail position;
- enforce tenant and model isolation;
- remove Zene-only metadata before dispatching through UniGateway;
- expose full-request fallback and session lifecycle operations.

SmartGate stores a **prefix snapshot**, not a recoverable Agent transcript and not
model KV blocks. KV continuation remains an optional inference-engine capability.

### 1.1 Responsibility versus implementation status

This specification defines a contract between three independently evolving
components. The responsibility matrix is normative even when a component does
not yet implement every behavior:

- **Zene owns recovery behavior.** It decides when to increment `epoch`, retains
  the full transcript, and switches to `delivery=full` when publish or delta
  context state cannot be trusted.
- **SmartGate owns execution-state enforcement.** It must not report a successful
  publish before the snapshot is readable, must reject stale or conflicting
  state, and must not call upstream after context validation failure.
- **UniGateway owns provider execution.** It receives an already assembled normal
  request and must not need to understand Zene session semantics.

The current Zene client sends `epoch`, `message_count`, `messages`, and
`pinned_boundary` on publish. `prefix_hash`, `virtual_model`, `request_id`, and
an explicit hash algorithm version are compatibility enhancements; the Warm MVP
must not reject an otherwise valid current Zene publish solely because these
optional fields are absent.

```text
Zene transcript/context engine
        │ publish canonical prefix or send full/delta request
        ▼
SmartGate Warm adapter
        │ validate, assemble, strip _zene_context
        ▼
SmartGate policy and routing
        ▼
UniGateway data plane
        ▼
Upstream inference service
```

## 2. Endpoint surface

The gateway URL is configured by Zene as `ZENE_INFERENCE_GATEWAY_URL` without a
trailing slash.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/zene/sessions/{session_id}/publish` | Create or replace the canonical prefix |
| `DELETE` | `/v1/zene/sessions/{session_id}` | Close and release session prefix state |
| `POST` | `/v1/chat/completions` | Accept a full or delta request and proxy it upstream |

The session endpoints use the same SmartGate client authentication as model
traffic. They are not Admin or SaaS endpoints.

## 3. Context envelope

Zene may send context metadata in headers or in the request body. The body form
is required for the production path where UniGateway does not convert metadata
into HTTP headers.

```json
{
  "_zene_context": {
    "session_id": "run-123",
    "context_epoch": 2,
    "delivery": "delta",
    "prefix_hash": "0123456789abcdef",
    "tail_start": 42,
    "request_id": "request-456"
  }
}
```

Supported fields:

| Field | Header alternative | Warm MVP requirement | Meaning |
|---|---|---:|---|
| `session_id` | `X-Zene-Session-Id` | delta: yes | Stable Agent run identifier |
| `context_epoch` | `X-Zene-Context-Epoch` | delta: yes | Version of the canonical prefix |
| `delivery` | `X-Zene-Context-Delivery` | no | `full` or `delta`; default is `full` unless explicitly negotiated |
| `prefix_hash` | `X-Zene-Prefix-Hash` | recommended | Fingerprint of the canonical prefix; gateway may calculate it when absent |
| `tail_start` | `X-Zene-Tail-Start` | delta: yes | Message-array index at which the tail begins |
| `request_id` | `X-Zene-Request-Id` | optional | Stable identifier for request tracing and retry analysis |

The current Zene production path may send the same metadata in both headers and
`_zene_context`. Resolve each field independently: use the only representation
when only one is present; when both are present, require equal values. A conflict
between the two representations is a `400 INVALID_CONTEXT` error. Do not silently
use a different header value over a conflicting body value.

A deployment may choose body-only operation for the production path, or header
only for clients that cannot use the body extension, but both forms must have the
same semantics.

The gateway must remove `_zene_context` before converting or dispatching the
request through UniGateway. Zene metadata must never be sent to an upstream
OpenAI-compatible provider as part of the provider request body.

## 4. Prefix snapshot model

A session stores one current immutable snapshot. The logical record contains:

| Field | Description |
|---|---|
| `session_id` | External Zene session identifier |
| `project_id` | SmartGate project owner |
| `api_key_id` | Owning credential, unless a stable principal is configured |
| `virtual_model_id` | Virtual Model used to establish the session |
| `pool_id` | Model Pool resolved at publish time |
| `epoch` | Current canonical-prefix version |
| `prefix_hash` | Gateway-verified hash of `messages` |
| `message_count` | Must equal `messages.length` |
| `messages` | Canonical prefix snapshot |
| `pinned_boundary` | Pinned range `[0, pinned_boundary)` |
| `hash_algorithm_version` | Version of the agreed canonicalization algorithm |
| `expires_at` | Session TTL deadline |
| `closed_at` | Set after explicit close, if retained for audit |

The prefix store is execution state. It must not become the source of truth for
Zene transcript recovery.

### 4.1 Hash contract

Zene and SmartGate must use the same canonical message serialization and hash
algorithm. The current Zene implementation is the compatibility baseline for
hash version `v1`:

- hash the messages in array order;
- include the message `role`, `content`, `tool_calls`, and `name` fields using the
  current Zene fingerprint representation;
- do **not** include `tool_call_id` in v1, even though it may be present in the
  published JSON message;
- use Rust `DefaultHasher` as currently implemented by Zene;
- format the resulting value as lowercase 16-character hexadecimal.

This describes compatibility with the current implementation; it is not a
recommendation to treat `DefaultHasher` as a long-term cross-language cryptographic
standard. SmartGate and Zene must use shared test vectors before enabling strict
client-provided hash validation.

When `prefix_hash` is absent in Warm MVP requests, SmartGate calculates and stores
its own v1 hash. When a client supplies a hash, SmartGate recomputes the v1 hash
and rejects a mismatch. On delta, the request hash is compared with the stored
snapshot hash when both are available; a missing request hash does not disable
session, epoch, or `tail_start` validation.

The algorithm and its version must be part of the protocol contract. A future
algorithm, such as one that includes `tool_call_id`, must be a new version with
new test vectors. It must not silently reinterpret old snapshots. The hash is a
consistency fingerprint, not an authorization credential or a signature.

### 4.2 Pinned boundary

`pinned_boundary` uses a half-open range:

```text
messages[0..pinned_boundary)
```

It must satisfy:

```text
0 <= pinned_boundary <= message_count
```

Zene owns the meaning of pinned messages. SmartGate only records the boundary
and must preserve that range if it later performs storage eviction or block-level
retention. The initial Warm implementation must not semantically trim or rewrite
published messages.

## 5. Publish semantics

### 5.1 Request

The Warm MVP compatibility minimum is:

```json
{
  "epoch": 2,
  "message_count": 42,
  "messages": [],
  "pinned_boundary": 3
}
```

The following fields are optional enhancements:

| Field | Status | Meaning |
|---|---|---|
| `prefix_hash` | Optional in Warm MVP | Client-supplied v1 hash; SmartGate calculates it when absent |
| `virtual_model` | Optional in Warm MVP | Explicit model binding for stricter session isolation |
| `hash_algorithm_version` | Optional in Warm MVP | Defaults to the negotiated v1 compatibility algorithm |
| `request_id` | Optional in Warm MVP | Publish tracing and idempotency diagnostics |

`messages` is the complete canonical prefix, not an append-only fragment.
`message_count` must equal the number of messages in the array. If an optional
client hash is present, SmartGate must verify it before accepting the snapshot.
The optional `virtual_model` is not required until the client is able to send it;
SmartGate may instead bind the session to the Virtual Model resolved from the
authenticated model request or configured integration context.

### 5.2 Success and idempotency

A `2xx` response means the complete snapshot has been durably accepted by the
configured prefix store. SmartGate must not return success before the snapshot
is readable by a subsequent delta request.

Publish is idempotent:

| Existing state | Incoming publish | Result |
|---|---|---|
| No session | Any valid epoch | Create session |
| Same epoch and same hash | Same content | Idempotent success; no change |
| Same epoch and different hash | Different content | `409 EPOCH_CONFLICT` |
| Lower epoch | Any content | `409 STALE_EPOCH` |
| Higher epoch | Any valid complete prefix | Atomic replacement |

Epochs may skip values. For example, epoch `1` may be replaced directly by epoch
`3` if epoch `2` was never successfully published. The gateway should record the
gap for diagnostics but must not require contiguous epochs.

### 5.3 Atomic replacement and concurrency

A publish operation must validate the complete request and then replace the
snapshot atomically. It must not expose an intermediate state such as a new epoch
with an absent or old message array.

Concurrent publishes must obey the same monotonic rules:

- a lower epoch cannot overwrite a higher epoch;
- same epoch and same hash may complete successfully more than once;
- same epoch and different content has one winner and one `409 EPOCH_CONFLICT`;
- an old delayed request must never restore an old prefix.

A chat request reads an immutable snapshot. A later publish may replace the
session's current snapshot, but must not mutate the snapshot already used to
assemble an in-flight request.

### 5.4 Publish failure

If the store is unavailable or the request cannot be durably accepted, SmartGate
returns a non-2xx response such as `503 PUBLISH_UNAVAILABLE`. It must not return a
successful response for an asynchronous or uncertain write.

Zene must then mark delta delivery as unavailable and use a self-contained full
request until a later publish succeeds.

## 6. Chat completion semantics

All context validation occurs before SmartGate invokes UniGateway or any
upstream. A context validation error must not cause an upstream model call.

### 6.1 Full delivery

For `delivery=full`:

1. SmartGate uses `body.messages` as the complete request context.
2. It does not require an existing session.
3. It does not compare the request epoch with stored state.
4. It does not read or update the prefix snapshot.
5. It removes `_zene_context` and dispatches the resulting normal request.

Full delivery is the recovery path after publish failure or a session mismatch.
It is an independent request and must not implicitly publish or overwrite the
canonical prefix.

For Zene requests, SmartGate should disable context trimming by default. A gateway
rewrite of the messages would invalidate the Agent's canonical-prefix assumptions.

### 6.2 Delta delivery

For `delivery=delta`:

1. Authenticate the SmartGate API key.
2. Resolve and authorize the requested Virtual Model.
3. Resolve the session within the authenticated namespace.
4. Load an immutable current snapshot.
5. Validate epoch and prefix hash.
6. Validate `tail_start`.
7. Construct `full_messages = stored_prefix.messages || body.messages`.
8. Replace `body.messages` with `full_messages`.
9. Remove `_zene_context`.
10. Continue through normal SmartGate budget, routing, and UniGateway dispatch.

The chat request must not update the canonical prefix. Only `publish` changes
that state.

### 6.3 Tail position

`tail_start` is a message-array index, not a token offset. In the initial protocol
it must exactly equal the stored prefix's `message_count`:

```text
tail_start == stored_prefix.message_count
```

The first version does not support partial replacement, rewind, or patching a
stored prefix. If Zene needs a different canonical history, it publishes a new
complete prefix with a new epoch.

A full request ignores `tail_start`. If a full request contains an invalid context
field that conflicts with the header, it still returns `400 INVALID_CONTEXT`.

### 6.4 Parallel deltas

Multiple read-only delta requests may use the same session and epoch. They each
receive the same immutable prefix snapshot and do not append their results to the
session automatically.

Implicit append is intentionally not part of this protocol. Persisting an
assistant response or tool result requires a later explicit `publish` from Zene.

## 7. Zene fallback behavior

Zene owns recovery because it owns the complete transcript. The behavior in this
section is the target client behavior required for reliable delta delivery; it is
not implied by the current Zene implementation merely because the protocol fields
exist.

### 7.1 Publish failure

When publish times out, returns 5xx, or its result cannot be confirmed:

1. Mark the session `delta_ready = false` locally.
2. Send the next model request with `delivery=full`.
3. Generate complete `messages` from the local transcript.
4. Retry publish asynchronously or before a later step.
5. Resume delta only after publish returns 2xx.

### 7.2 Delta context error

For `SESSION_NOT_FOUND`, `EPOCH_MISMATCH`, `PREFIX_HASH_MISMATCH`, or
`TAIL_START_MISMATCH`:

1. Do not retry the same delta unchanged.
2. Rebuild the full request from the local transcript.
3. Retry once with `delivery=full` and a new request ID or an explicit retry marker.
4. Publish the current canonical prefix.
5. Resume delta after publish succeeds.

Because SmartGate validates before upstream dispatch, this fallback does not
repeat a model call caused by a context validation failure.

Zene should use a stable request ID for tracing and distinguish a full recovery
retry from a new logical Agent step. Usage systems must not silently count a
rejected delta as an upstream attempt.

### 7.3 Required Zene client state transition

Zene must not mark a newly published prefix as delta-ready before publish
success. The state transition is:

```text
construct canonical prefix
  → publish
  → 2xx: update gateway_prefix_len and set delta_ready=true
  → failure/timeout: keep the previous acknowledged state and set delta_ready=false
```

After a failed publish, the next request must use `delivery=full`; it must not use
the unacknowledged `gateway_prefix_len` to construct a delta. The client may retry
publish asynchronously, but it may resume delta only after a confirmed 2xx.

At the time of this specification, the current Zene client and the reference
inference-gateway stub do not yet implement every behavior in this section. In
particular, fallback state, strict `tail_start` validation, structured error
handling, and publish-success gating must be treated as implementation work, not
as existing compatibility guarantees.

## 8. Session isolation and authorization

The Warm MVP has two compatibility levels:

- **Current-client compatibility:** session access is isolated at least by the
  authenticated SmartGate Project and session ID. This is sufficient for the
  current publish body, which does not include a Virtual Model field.
- **Strict isolation:** bind the snapshot to `project_id`, `api_key_id` (or a
  stable client principal), and `virtual_model_id`. Enable this when Zene sends
  the optional model binding or when SmartGate can derive it unambiguously from
  the authenticated request.

The gateway must not reject current Zene publish requests solely because the
optional model-binding field is absent. It must also not claim strict
Virtual-Model isolation when that binding is unavailable.

A bare `session_id` is never an authorization credential. SmartGate must resolve
it inside an authenticated namespace. The recommended initial binding is:

```text
(project_id, api_key_id, session_id)
```

The session snapshot must also record the `virtual_model_id` used to establish
it. A stricter or longer-lived deployment may replace `api_key_id` with an
explicit stable client principal, but it must not fall back to a global
`session_id` key.

Every publish, delta request, full request carrying session metadata, and delete
operation must be authorized against the session owner.

For security, the external response should normally be the same for a missing,
expired, closed, or unauthorized session:

```text
404 SESSION_NOT_FOUND
```

Detailed reasons may be logged internally but should not enable session ID
enumeration.

### 8.1 Virtual Model compatibility

A delta request must use the Virtual Model bound to the session, or an explicitly
configured compatible model contract. Different models must not share a prefix or
KV state by accident.

If Zene changes models, it should use a full request and publish a new compatible
session state. KV continuation, when supported, requires exact inference-model
compatibility and stronger worker/session affinity.

### 8.2 Upstream authorization

SmartGate authenticates the client API key but must not blindly forward that key
to a provider. The upstream credential comes from the configured Provider Account
or an explicitly configured upstream gateway credential.

"透传 Authorization" therefore means preserving client authentication at the
SmartGate boundary, not sending a project API key to a third-party provider.

## 9. Error contract

Errors should use a stable JSON envelope. The exact field names may follow the
existing SmartGate API convention, but the semantic `code` values must remain
stable.

```json
{
  "error": {
    "code": "EPOCH_MISMATCH",
    "message": "The request context does not match the stored session prefix",
    "retryable": false,
    "request_id": "request-456"
  }
}
```

Recommended errors:

| HTTP | Code | Producer | Meaning | Zene action |
|---:|---|---|---|---|
| `400` | `INVALID_CONTEXT` | SmartGate | Missing, malformed, or conflicting context fields | Fix request or use full |
| `404` | `SESSION_NOT_FOUND` | SmartGate | Missing, expired, closed, or unauthorized session | Rebuild and send full |
| `409` | `EPOCH_CONFLICT` | SmartGate | Same epoch has different content | Investigate concurrent publish |
| `409` | `STALE_EPOCH` | SmartGate | Publish epoch is lower than current | Drop stale publish |
| `409` | `EPOCH_MISMATCH` | SmartGate | Delta epoch differs from current | Rebuild and send full |
| `409` | `PREFIX_HASH_MISMATCH` | SmartGate | Request and stored prefix fingerprints differ | Rebuild, publish, then retry |
| `409` | `TAIL_START_MISMATCH` | SmartGate | Tail does not begin at stored message count | Rebuild and send full |
| `413` | `PREFIX_TOO_LARGE` | SmartGate | Prefix or assembled request exceeds configured limit | Compact or use configured limit |
| `409` | `SESSION_CLOSED` | SmartGate | Session is no longer active; can be hidden as 404 | Start or publish a new session |
| `503` | `PUBLISH_UNAVAILABLE` | SmartGate | Prefix could not be durably stored | Use full and retry publish |

For unauthorized sessions, SmartGate may map `EPOCH_MISMATCH` and other state
errors to `SESSION_NOT_FOUND` to avoid revealing session existence.

## 10. Lifecycle, TTL, and storage

The initial in-memory store is sufficient for protocol validation but is not a
production durability guarantee. A production deployment must define:

- session TTL and refresh behavior;
- maximum prefix bytes and message count;
- maximum assembled request size;
- atomic publish and snapshot reads;
- explicit delete behavior;
- eviction behavior that preserves `pinned_boundary`;
- multi-replica consistency or routing affinity;
- metrics for publish success, delta hit, full fallback, mismatch, expiry, and
  storage pressure.

`DELETE /v1/zene/sessions/{session_id}` should be idempotent. A missing or already
closed session is treated as successful cleanup from Zene's perspective. The
operation must still enforce ownership before deleting an existing session.

Prefix deletion is separate from future inference-engine KV deletion. If a KV
backend is attached later, close and epoch replacement should emit the appropriate
invalidate/release operation for `(session_id, epoch)`.

## 11. Responsibility matrix

| Capability | Zene | SmartGate | UniGateway / inference engine |
|---|---|---|---|
| Full transcript | Authoritative | Must not own | Not required |
| Compaction and memory | Authoritative | Must not perform | Not required |
| Epoch generation | Decides when to increment | Validates monotonicity | Uses epoch for execution state if supported |
| Prefix hash generation | Computes and sends | Recomputes and verifies | May observe/forward neutrally |
| Prefix storage | Publishes source snapshot | Stores Warm snapshot | KV storage is separate |
| Delta generation | Generates tail and `tail_start` | Validates | Receives assembled full request |
| Delta assembly | No | Yes | No Zene-specific knowledge |
| Full fallback decision | Yes | Provides full path and truthful errors | Executes full request |
| Session authorization | Supplies credential | Enforces | Must not understand product identity |
| Provider authorization | No | Selects Provider Account | Renders upstream request |
| Streaming | Consumes response | Preserves proxy behavior | Parses/renders protocol stream |
| KV continuation | Supplies session identifiers | May select affinity | Owns KV lifecycle and invalidate/release |

## 12. Current compatibility gaps

This document is the target SmartGate Warm baseline, not a claim that the current
Zene client or reference stub already satisfies every rule.

### 12.1 Zene client work

Zene must still add or verify:

- update `gateway_prefix_len` only after publish returns confirmed success;
- maintain a local `delta_ready` state;
- switch to `delivery=full` after publish failure or delta context errors;
- rebuild full messages from the local transcript for recovery;
- republish before resuming delta;
- send `prefix_hash` when strict client-side hash validation is enabled;
- provide stable request IDs if request-level retry correlation is required;
- keep header and body context values identical when both are sent.

### 12.2 SmartGate and reference-stub work

SmartGate or the reference implementation must still add or verify:

- exact `tail_start == stored.message_count` validation;
- idempotent publish and `STALE_EPOCH` / `EPOCH_CONFLICT` responses;
- structured error codes and retry guidance;
- namespace isolation and ownership checks;
- durable-write-before-2xx publish semantics;
- `503 PUBLISH_UNAVAILABLE` for failed or uncertain storage;
- no upstream call after context validation failure;
- hash v1 compatibility vectors and explicit version handling.

These gaps do not change the protocol boundary. They identify the work required
to make the target behavior reliable in production.

## 13. SmartGate Warm configuration

Warm storage is configured through environment variables. All limits are
unlimited and TTL is disabled by default for backwards compatibility.

| Variable | Default | Meaning |
|---|---:|---|
| `SMARTGATE_WARM_IDLE_TTL_SECS` | unset | Idle session lifetime; unset disables idle expiry |
| `SMARTGATE_WARM_MAX_LIFETIME_SECS` | unset | Absolute session lifetime; unset disables the absolute limit |
| `SMARTGATE_WARM_MAX_MESSAGES` | unset | Maximum messages in a published prefix |
| `SMARTGATE_WARM_MAX_PREFIX_BYTES` | unset | Maximum serialized prefix size |
| `SMARTGATE_WARM_MAX_TAIL_BYTES` | unset | Maximum serialized delta tail size |
| `SMARTGATE_WARM_MAX_ASSEMBLED_BYTES` | unset | Maximum serialized prefix plus tail size |
| `SMARTGATE_WARM_CLEANUP_INTERVAL_SECS` | `60` | Background cleanup interval; `0` disables the sweep |
| `SMARTGATE_WARM_REDIS_URL` | unset | Redis URL for shared persistent Warm sessions and Virtual Model bindings; `REDIS_URL` is accepted as a fallback |
| `SMARTGATE_WARM_REDIS_KEY_PREFIX` | `smartgate:warm:` | Shared Redis key prefix; all replicas and environments using one Redis must use the same value |
| `SMARTGATE_WARM_REQUIRE_VIRTUAL_MODEL` | `false` | Require an authorized `virtual_model` on every Warm publish |

The cleanup task only removes expired sessions. Lazy expiry remains active on
session reads and writes. When Redis is configured, both the Warm prefix and its
Virtual Model binding are persisted with the same tenant-qualified session key.
The publish endpoint authorizes a supplied `virtual_model` against the authenticated
Project and API Key before persisting it. In strict deployments, set
`SMARTGATE_WARM_REQUIRE_VIRTUAL_MODEL=true`.

Warm operational counters are available from the authenticated
`GET /v1/zene/metrics` endpoint. Counters are bounded and do not include session
IDs, API keys, or arbitrary model names. Redis binding cleanup uses cursor-based
`SCAN`, not blocking `KEYS`. Prefix publish and Virtual Model binding publication
use one Redis Lua operation, so an accepted Redis publish cannot expose a new
prefix with an old binding.
SmartGate does not trim or rewrite oversized messages; it rejects them so Zene
can compact and publish a new epoch.

## 14. Implementation order and acceptance criteria

### Phase 1: Warm protocol MVP

- publish and delete endpoints;
- in-memory or shared prefix store;
- full and delta delivery;
- epoch and prefix hash validation;
- exact `tail_start` validation;
- context stripping before UniGateway;
- streaming passthrough;
- no upstream call on context validation errors;
- Zene full fallback after publish or delta context failure.

### Phase 2: Reliability and isolation

- atomic monotonic publish;
- idempotent retries;
- session namespace binding;
- Virtual Model compatibility;
- TTL, size limits, and metrics;
- shared store or documented single-replica affinity;
- stable structured errors.

### Phase 3: Cache and KV enhancements

- cached and uncached token reporting;
- cache-aware pricing and routing;
- session affinity;
- session-level usage and budgets;
- inference-engine KV continuation;
- epoch invalidation and session close propagation.

The implementation is complete for the Warm MVP only when all of the following
are true:

1. A successful publish is immediately usable by delta chat.
2. A failed publish causes Zene to use full delivery.
3. A stale or conflicting publish cannot overwrite a newer snapshot.
4. Invalid delta requests fail before upstream dispatch.
5. Full delivery works without a stored session and does not mutate it.
6. `tail_start` is checked against the stored message count.
7. Session access is isolated by authenticated SmartGate identity.
8. `_zene_context` never reaches the upstream provider.
9. Streaming responses remain compatible with Zene.
10. Delete is safe to retry and releases the Warm prefix state.

## 15. Related documents

- [Harness, agents & client integration](./harness.md)
- [SmartGate product scope](../scope.md)
- [SmartGate roadmap](../roadmap.md)
- [UniGateway optimization primitives](../unigateway_optimization.md)
