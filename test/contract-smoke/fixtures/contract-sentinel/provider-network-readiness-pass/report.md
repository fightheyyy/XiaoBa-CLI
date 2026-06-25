# Provider Network Readiness Report

- generated at: 2026-06-05T00:00:00.000Z
- decision: pass
- replay enabled: true
- degradation verified: true
- provider: openai
- api base configured: true
- api key configured: true
- model configured: true
- checks: 6/6 passed
- blocked checks: 0
- failed checks: 0

This fixture proves an explicitly enabled provider-network replay can persist structured degraded provider transcript evidence without storing raw provider payloads.

## Checks

| Check | Status | Severity | Message |
| --- | --- | --- | --- |
| provider_network.opt_in | pass | environment | provider network replay is explicitly enabled |
| provider_network.config | pass | configuration | provider-network replay uses injected AI service for verification |
| provider_network.runtime | pass | execution | Provider-network runtime path completed |
| provider_network.session_log | pass | evidence | provider-network replay wrote session JSONL evidence |
| provider_network.provider_error | pass | evidence | provider_error runtime event evidence is present |
| provider_network.degraded_provider_transcript | pass | evidence | degraded provider transcript boundary evidence is structured |
