# Read-only signal export

This API exposes persisted Allocation Lab optimizer outputs for a private downstream dashboard. It does not connect that dashboard automatically.

## Security and deployment

- Configure `SIGNAL_EXPORT_TOKEN` as a Replit Secret in every environment that should serve the integration.
- The dashboard backend/BFF sends `Authorization: Bearer <token>`.
- Never put the token in browser JavaScript. Requests carrying browser `Origin` or `Sec-Fetch-Mode` headers are rejected.
- All signal responses use `Cache-Control: no-store`.
- If the secret is absent, the API returns `503 integration_not_configured`.

## Endpoints

- `GET /api/signals/catalog` — persisted signals plus implemented request-time-only capabilities.
- `GET /api/signals/latest` — latest persisted observation per signal and asset.
- `GET /api/signals/history` — stored observations only, without interpolation.

`latest` and `history` accept exact `signalId` and `asset` filters, inclusive `dateFrom`/`dateTo`, and `limit` (default 1000, maximum 5000).

## Data boundaries

- Market history comes only from the most recently stored `price_data.csv_content`.
- Optimizer history comes only from saved `sessions.result_json`, enriched with optional governance source/version metadata.
- Source nulls, negative values, original dates, original JSON paths, and available version metadata are preserved.
- Backtest, Risk Model Pro, attribution, scenario stress, and trade implementation are cataloged as `request_time_only`. The export never runs them and returns no invented history for them.
- The export does not create models, fill gaps, interpolate dates, or execute the optimizer.