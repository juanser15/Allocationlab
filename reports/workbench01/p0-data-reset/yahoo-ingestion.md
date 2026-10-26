# Yahoo Finance ingestion and evidence boundary

Production retrieval is server-side in `persistent-datasets.ts::ingestYahoo`. It uses only `https://query1.finance.yahoo.com/v8/finance/chart/<validated-symbol>`, with redirects rejected. Requests cannot supply hosts, paths, commands or output locations. No credentials are sent to the provider.

The user supplies tickers, From and inclusive To. This phase accepts Daily Adjusted Close only. Symbols are validated, deduplicated and sorted; 1–64 may be requested. Dates must be real ordered ISO dates and cannot request a future end. Only completed observations before the current UTC date are included. USD instruments are required; a non-USD symbol receives a precise source failure rather than silently implying currency conversion.

## Retrieval and normalization

The fetcher runs batches of at most four ticker requests. Each request has a 15-second timeout; the whole batch sequence has a 60-second deadline. Raw source responses are bounded to 8 MiB per ticker and 64 MiB aggregate; normalized CSV is bounded to 32 MiB. A failed symbol remains explicitly listed. If all symbols fail, no draft is saved or activated.

Only Yahoo's adjusted-close array is accepted. Raw close is not a fallback. Received timestamps establish the observed union calendar, including null/invalid-price dates. Missing cells remain empty. Invalid/nonpositive prices are counted and left unavailable; identical duplicate observations are counted and deduplicated; conflicting duplicates reject that symbol. No inferred exchange sessions, forward-fill or interpolation are added.

QA contains successful/failed symbols, source timestamp, union and complete-case observations, per-symbol first/last/valid/missing counts and coverage, duplicate counts, invalid-price counts, large calendar gaps and warnings. Metadata records `source = YAHOO_FINANCE`, `pit_status = VINTAGE_UNVERIFIED`, exact normalized payload SHA-256 and an aggregate hash of per-symbol raw response hashes. Yahoo vintages are research inputs, not independently PIT-certified observations; this warning does not itself block research.

Fetch returns a persistent draft for inspection. SAVE DATASET creates a named immutable version. USE THIS DATASET is a separate explicit activation. Refresh creates a new version, leaving historical versions and run references unchanged. The application never selects a substitute internal snapshot when the requested version is unavailable.

## What has and has not been verified

The current managed execution environment denies the Yahoo host with proxy CONNECT HTTP 403. A network-host addition has been saved as a draft configuration; it requires the owner to publish before a new permitted environment can run the live-provider acceptance. This task has not bypassed that restriction or altered deployed Render network configuration.

`scripts/p0-provider-fixture.mjs` is a test-only transport loaded explicitly by the acceptance harness. It returns Yahoo-shaped responses built from committed historical observations. It is not loaded by the production launcher. Reports identify this as `TEST_PROVIDER_WIRE_FIXTURE_FROM_COMMITTED_OBSERVATIONS`, and test datasets carry explicit fixture notes. These are actual historical observations for engine reconciliation, but they are not evidence that Yahoo was contacted.

Actual PostgreSQL save/activate/download, restart, clean-runtime and worker execution pass under that labelled transport. Browser fetch/QA/save/activate flows also pass with it. Live SPY and model-input-universe fetches, followed by save/activate/restart/execute, remain mandatory and unverified. This phase must not be declared fully ready while that gate remains blocked.
