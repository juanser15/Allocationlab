---
name: Deterministic AI committee pattern
description: How to build "AI" persona/reasoning layers that must never fabricate numbers
---

When a product spec asks for an AI-labeled reasoning layer (e.g. an "Investment Committee",
advisory personas, synthesized recommendations) but also requires that every number and claim
be strictly grounded in already-computed data with zero fabrication risk, do not reach for an
LLM call. Instead:

- Implement it as a deterministic, rule-based function that reads already-computed inputs
  (scores, diagnostics, audit results, etc.) and maps them to structured outputs (stance,
  confidence, evidence strings, key concerns) via explicit conditionals/thresholds.
- Every evidence string should be built by interpolating real computed values, never
  free-generated text.
- Guardrails (e.g. downgrading confidence) should be explicit rules tied to specific missing
  data conditions or failed checks (e.g. failed integrity/audit scores), each with a
  human-readable reason recorded in a "data quality notes" list.
- Document in a code comment that the layer is intentionally non-generative, so future
  maintainers don't "upgrade" it to an LLM call and reintroduce fabrication risk.

**Why:** The user's product requirement was an explicit, hard guarantee against fabricated
figures in a financial advisory context — a generative call cannot make that guarantee, but a
pure function over computed inputs can.

**How to apply:** Whenever a spec says "AI [X]" + "never fabricate" / "strictly grounded in
computed data" in the same request, default to rule-based synthesis, not a model call.
