//! SmartGate — lightweight AI gateway (control plane + intelligent Auto/Pro/Flash routing + xlite data plane).

pub mod api;
pub mod auth;
pub mod config;
pub mod db;
pub mod free_token;
pub mod models;
pub mod policy;
pub mod pricing;
pub mod quota;
pub mod routing;
pub mod server;
pub mod sync;
#[cfg(test)]
mod tests;
pub mod usage;

pub use config::Config;
