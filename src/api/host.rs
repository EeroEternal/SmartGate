//! UniGateway pool host integration shared by the proxy and the auxiliary judge.

use unigateway_sdk::core::UniGatewayEngine;
use unigateway_sdk::host::{HostFuture, PoolHost, PoolLookupOutcome, PoolLookupResult};

pub(super) struct SmartGatePoolHost<'a> {
    pub(super) engine: &'a UniGatewayEngine,
}

impl PoolHost for SmartGatePoolHost<'_> {
    fn pool_for_service<'a>(
        &'a self,
        service_id: &'a str,
    ) -> HostFuture<'a, PoolLookupResult<PoolLookupOutcome>> {
        Box::pin(async move {
            Ok(self
                .engine
                .get_pool(service_id)
                .await
                .map(PoolLookupOutcome::Found)
                .unwrap_or(PoolLookupOutcome::NotFound))
        })
    }
}
