# D6 bounded closure report — D6 BLOCKED

Date: 2026-09-29. Diagnosis began at approximately 18:08 UTC and concluded within the declared **D6 BLOCKED — T6–T8 siguen sin cerrar.**

- El 502 anterior **no se reprodujo**. El servidor registró HTTP **201 en 32,723 segundos** y guardó la Validation Run **#515** para la asignación #291.
- La ejecución quedó fallida por: **“D5 zero-regularization comparison failed: Invalid target exposure for D6B on 2025-11-03.”**
- No quedó conservado el valor rechazado. No apliqué una corrección especulativa ni repetí la validación.
- La conservación de evidencia tuvo un error: el navegador sobrescribió la traza intermedia. El informe lo declara y distingue los logs independientes del servidor de la consulta posterior.
- Typecheck pasó; **137 pruebas pasaron**, ninguna falló y una seed opcional quedó omitida.
- Los fixtures siguen preservados y visibles como **TEST_ONLY**; no se restauró ni sustituyó ningún dataset de mercado.

Informe guardado: [D6_CLOSURE_REPORT.md](reports/D6_CLOSURE_REPORT.md). Se detiene el trabajo sin iniciar otra etapa.-minute bound. One final independent regression batch completed within its 15-minute bound. No later-stage work is included.

## Revision and changes

Base: `daabbc84d7a2866bbd6f6c2a79aad3381b3bde97`. Application source changed only for request-scoped diagnostic tracing and a visible TEST_ONLY warning. These changes are uncommitted at report time. No financial correction was made.

Final source manifest: `reports/d6-evidence/source-files.sha256`.
Manifest SHA-256: `f18525e5660eb763f97a20a8105cb8e0de7d0384f1fbd69bef5497428cfa5df6`.
The manifest includes the new trace helper as well as tracked application/library source.

Ridge/HAC, dates, factors, constraints, risk, D4/D5 parameters, A1 accounting, tolerances and frozen records were not altered.

## Retained identities and activity

Before execution, GET validation runs for allocation #291 returned an empty list. The original API process no longer existed; the then-current API was responsive and no active validation worker was observed. This application has no durable active-validation job registry.

Retrieved #291 was SOLVED. Its saved request referenced policy B1 #316, five D6A–D6E assets, momentum/trend_quality/volatility, Ridge lambda 1, 252-date window, minimum 60, HAC 5, same_close, D4 kappa 0.25, D5 lambdaR 0.01, and explicit cash-only holdings. Evaluation B1 #317 referenced dataset #19 and hash `d8d49a9b4e27a91d5c6c2aad773d84329fa252c8a303c08a2405826725be7b4f`.

One retained-case B3 Validate was performed through the actual UI:

- Allocation #291; evaluation #317.
- 2025-09-23–2026-05-18; monthly / same_close.
- NAV and cash 100000; zero quantities for each of the five assets.
- Transaction costs 10 bps, slippage 5 bps, daily cash yield 0.
- No replacement dataset, Optimize of #291, or modified financial case.

## Observed operation and response

The historical 502 was **not reproduced**. Its cause remains **unknown**.

The new POST `/api/validation-runs` was received at 18:15:14.013 UTC under diagnostic ID `b83d46e1-25b4-4199-8829-fb97da7f6d79`, PID 874. That receipt line was observed by the parent in the trace before the evidence incident below.

The independent API workflow log records request #38 completing at 18:15:46.670 UTC with **HTTP 201**, duration **32,723 ms**. This is server-observed HTTP evidence: the browser listener did not preserve the original POST response or its trace header.

The result was genuinely persisted as **Validation Run #515**, but with `status=failed`, reconciliation `fail`, and reproducibility `fail`. GET #515 returned HTTP 200. Its input hash is `aae50d5f36f2237d1df721096a0decb5aaaa8f84052298df0bd168ba6968b8b9`.

Exact persisted failure:

> D5 zero-regularization comparison failed: Invalid target exposure for D6B on 2025-11-03.

The localized rejecting operation is A1's explicit-target validation in `calculator.ts`, reached by B3's paired D5 zero-regularization comparison. Its existing condition rejects an unavailable ticker, nonfinite weight, or negative long-only weight. D6B is a declared asset, but the rejected numeric weight was **not retained**; the evidence cannot distinguish a negative weight from a nonfinite value. A numerical cleanup or changed comparison path would therefore be speculative. No such correction was applied.

The latest completed stage is **persistence and HTTP response of a failed validation**, not a successful ledger or replay.

## T1–T8 evidence

| Gate | Evidence / status |
|---|---|
| T1 | Applicable analytical ridge evidence retained; mathematical source unchanged. Focused suite passed in the final batch. |
| T2 | Existing timing/leakage unit/integration coverage retained and focused D6/B3 tests passed. This does not substitute for the missing successful retained-case execution. |
| T3 | Applicable preprocessing/identity/missing-input evidence retained; focused panel tests passed. |
| T4 | Applicable independent HAC/sandwich/replication evidence retained; focused mathematics suite passed. |
| T5 | Applicable B2/D4/D5 separation evidence retained; focused B2 test passed. No claim that the failed zero-D5 full-history branch passes. |
| T6 | **UNRESOLVED.** #515 retains nine main-path decisions, including 2025-09-23 (cutoff 09-22), 2025-10-01 (cutoff 09-30), and 2025-11-03 (cutoff 10-31), with same-day executions specified. But its failed result has an empty dailyLedger, and no valid full-ledger reconciliation or independent full-case evaluation metrics can be reported. The passing isolated-fit tests do not replace this evidence. |
| T7 | **UNRESOLVED.** No successful D6 Validation Run exists to perform the required fresh-client, changed-draft retrieval and successful immutable replay. No old-run replay was performed in this bounded closure. |
| T8 | **BLOCKED.** Actual Validate persisted #515 with a failure; no Replay action was run or claimed. |

**Original full-case ledger discrepancy:** unavailable, not zero.
**D6 replay maximum numeric difference:** unavailable, not zero.
**Old-run replay maximum difference:** unavailable, not zero.

## Verification

One final batch: root typecheck **PASS**; **26 suites**, **137 cases passed**, **0 failed**, **1 optional seed case skipped**. Includes affected A1/A2/A2.1/B1/B2/B3, D1/D2/D3/D4/D5, D6 mathematical/panel/integration and B3 storage coverage. Per-suite logs and counts are in `reports/d6-evidence/regressions/summary.tsv`.

The skipped D5 seed is optional, not a gate PASS. C2/C3 optional seeds were not run. C1–C3 were not rerun because no shared input/output contract they consume changed. Applicable prior passing evidence remains separate from this batch.

## Evidence integrity and incidental actions

- Browser evidence: `reports/d6-evidence/browser.json`; independent server logs: `server-start.log` and `server-observed.log` in that directory.
- The browser tester mistakenly **overwrote the server stage JSONL** with the later GET #515 response. Thus `validation-trace.jsonl` is not an intact correlated stage trace. Its large first record is persisted-result evidence, not the original POST response; later entries belong to later requests. The original intermediate-stage timings were lost. No reconstruction is presented as observed telemetry.
- During initial navigation the tester clicked the global Optimize action unintentionally. Independent logs show POST `/api/run` HTTP 400 in 852 ms, completed before the retained B3 attempt. It was not retried and is not counted as D6 optimization evidence.
- Logs also contain a later legacy POST creating #516, HTTP 201 in 980 ms, without allocation #291 and using legacy monthly/next_close assumptions. Its provenance is not established; the tester denied initiating it. It is not a D6 retry, successful D6 evidence, or an authorized replacement case. No attribution or deletion is invented.

These protocol/evidence limitations are disclosed rather than hidden by another browser attempt.

## TEST_ONLY and stopping decision

Dataset #19 and referenced frozen records remain preserved. The latest working metadata still matches the synthetic fixture; a visible TEST_ONLY banner now warns that it is not market evidence. No authoritative immediately preceding working-data selection was found, and none was guessed or restored. The user must explicitly select market data before producing a real-market report. Archived snapshots were not rewritten.

**D6 BLOCKED.** Required T6–T8 remain unresolved at the saved zero-D5 comparison target-exposure rejection. The rejected value and intact intermediate trace are unavailable, so the evidence does not justify the one allowed corrective patch. No second retained-case validation, speculative numerical change, success claim, or later-stage work was performed. STOP.