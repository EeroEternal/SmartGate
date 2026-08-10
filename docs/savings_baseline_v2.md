# Savings baseline v2

## Background

The first version of Context savings uses one configured Endpoint from one Model
Service as the comparison baseline. This makes the estimate deterministic and
keeps the configuration understandable, while still reusing the prices already
configured for Model Service endpoints.

## Planned v2 improvements

### Multi-model baseline

Allow a user to select multiple models or endpoints from a Model Service as the
comparison set. Merely selecting several models is not sufficient: the baseline
must define how requests are distributed among them.

Supported strategies to evaluate:

- **Fixed traffic weights**: configure a percentage for each selected model;
- **Reuse the Model Service routing policy**: apply the service's existing
  routing strategy and pool weights;
- **Request-class routing**: map simple, tool-enabled, or capability-sensitive
  requests to different baseline models;
- **Historical traffic mix**: derive the baseline distribution from a selected
  historical period, with a visible snapshot timestamp.

The first two options are the most predictable candidates for an initial v2
implementation. A multi-model baseline should display the effective mix and
prices used for every estimate.

### Baseline versioning and auditability

Store a version or immutable snapshot whenever the baseline changes. Historical
savings reports should retain the baseline prices and model mix that produced
them, rather than changing retroactively when an Endpoint price is edited.

### Better confidence reporting

Expose confidence alongside the dollar estimate, including:

- provider-reported versus locally estimated token usage;
- pricing coverage for the compared requests;
- the amount of trimmed context represented by the estimate;
- whether the baseline is a single model, weighted mix, or historical mix.

### Scope and product boundary

Baseline selection remains a SmartGate control-plane concern. UniGateway should
continue to execute requests and report neutral usage/context signals; it should
not know about Model Services, projects, or savings configuration.

## Open decisions for v2

1. Should the default multi-model mix reuse the service's current routing policy
   or require explicit weights?
2. Should a baseline compare all project traffic or only traffic addressed to
   the selected Model Service?
3. How should requests with missing provider usage or unpriced endpoints affect
   the estimate and confidence score?
4. Should users be able to compare multiple historical baseline configurations?
