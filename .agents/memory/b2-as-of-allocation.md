---
name: B2 as-of allocation boundary
description: Why new as-of allocation results must not inherit legacy historical validation behavior
---

B2 allocation is an as-of decision from an explicitly selected immutable B1 preparation. Keep it separate from legacy run/validation sessions and mark historical-policy validation unavailable until a compatible validation path is deliberately built. A frozen B2 replay uses the exact prepared input and optimization settings; working dataset or candidate changes cannot redefine an old result.

**Why:** The legacy constructor/backtester follows different portfolio rules. Treating a B2 result as a legacy session would silently validate another policy or present stale diagnostics as evidence for the new allocation.

**How to apply:** Any feature consuming B2 results should use the saved B2 identity and explicitly frozen assumptions. Never infer historical validation from a legacy session ID or swap current B1 inputs into a saved allocation.