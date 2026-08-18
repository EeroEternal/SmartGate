//! SmartGate — open-source AI gateway (control plane host + UniGateway data plane).
//!
//! Product scope: `docs/scope.md`. Roadmap: `docs/roadmap.md`.

pub mod api;
pub mod auth;
pub mod config;
pub mod db;
pub mod models;
pub mod policy;
pub mod pricing;
pub mod quota;
pub mod routing;
pub mod saas;
pub mod server;
pub mod sync;
#[cfg(test)]
mod tests;
pub mod usage;
pub mod warm;

pub use config::Config;
