---
name: Reports generate/download two-step flow
description: The reports API separates report generation from file download via a token, not a direct file response
---

## Behavior
`POST /api/reports/generate` does not return the PDF/CSV bytes directly. It returns JSON: `{ format, downloadToken, filename, generatedAt }`. The actual file bytes are only served by `GET /api/reports/download/:token`.

**Why:** decouples report generation (which needs the POST body with title/subtitle/date/portfolioName/internalNote) from the download step, so the frontend can trigger a browser download via a plain link/window navigation to the token URL without re-sending the form body.

**How to apply:** when testing or scripting against the reports API (e.g. via curl), always do the two-step flow — POST to generate, extract `downloadToken` from the JSON response, then GET `/api/reports/download/:token` to get real file bytes. A single POST alone will look like it "worked" (200 status) but the saved file will just be the JSON envelope, not a real PDF/CSV.
