---
name: yahoo-finance2 v3 usage
description: How to correctly use yahoo-finance2 v3 in this project (class instantiation, overload typing, adjClose access)
---

# yahoo-finance2 v3 usage

**Rule:** Must use `new YahooFinance()` — the singleton default export is gone in v3.

**Why:** v3 changed the API to require explicit instantiation. Using the default singleton throws "Call `const yahooFinance = new YahooFinance()` first" at runtime.

**How to apply:**
```ts
import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
// Then: await yahooFinance.historical(ticker, { ... })
```

**Overload typing:** Pass `events: "history" as const` and `interval: "1d" as const` to narrow to `HistoricalHistoryResult` (iterable). Without `as const`, TypeScript resolves the return to `never`.

**adjClose access:** The `adjClose` field exists at runtime but may not be in the declared type. Access as `(row as { adjClose?: number }).adjClose ?? row.close`.

**Rate limiting:** Insert a 350ms delay between tickers and use a 20s per-ticker timeout with 3 retries (1.5s × attempt backoff).
