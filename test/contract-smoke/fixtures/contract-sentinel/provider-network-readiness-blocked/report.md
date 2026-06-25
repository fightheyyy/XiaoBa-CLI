# Provider Network Readiness Report

- generated at: 2026-06-05T00:00:00.000Z
- decision: blocked
- replay enabled: false
- degradation verified: false
- provider: openai
- api base configured: false
- api key configured: false
- model configured: false
- checks: 0/1 passed
- blocked checks: 1
- failed checks: 0

This fixture proves provider-network readiness remains explicit opt-in evidence rather than a default user authorization burden.

## Checks

| Check | Status | Severity | Message |
| --- | --- | --- | --- |
| provider_network.opt_in | blocked | environment | set XIAOBA_PROVIDER_NETWORK_REPLAY=true or pass --enable to run provider-network replay |
