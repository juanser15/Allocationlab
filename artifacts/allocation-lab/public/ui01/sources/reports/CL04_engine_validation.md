# CL-04 — Capital Research Engine Validation & Hardening

**PASS en los 15 criterios obligatorios.** 199/199 tests individuales aprobados, cero fallos/omitidos finales; 16 son los originales CL03 intactos, 8 regresiones de defectos y 175 casos adicionales. Se preservó el FAIL previo de cada defecto. No se buscó alpha ni se agregaron familias financieras.

## Checkpoint y alcance

Repositorio `/workspace/Allocationlab`, `juanser15/Allocationlab`; rama `work`; commit `1163a0b574b573004372a3a2fc8752810dea7ef9`. Checkpoint antes de modificar: [checkpoint.json](cl04/baseline/checkpoint.json), 391 hashes. Estado inicial con calculator corregido de CL01 y trabajo CL01/02/03 pendiente; no reset/checkout. Estado final: [final-git-status.txt](cl04/final-git-status.txt).

386 archivos protegidos tienen el mismo hash: producción, calculator, CL01 tests/reporte, CL02 y CL03 resultados/configs/manifests, manifests de paquetes/lockfiles, tests originales CL03 y código research no corregido. Cinco archivos research existentes cambiaron bajo autorización de hardening: engine.ts, metrics.ts, registry.ts, storage.ts y README.md. Sus versiones originales y el resto de research están archivados bit a bit en `cl04/baseline/research/capital/`. [preservation.json](cl04/preservation.json) permite verificarlo. No producción, deploy, push, merge ni backtests históricos nuevos; los históricos CL03 sólo se leyeron para replay.

## Matriz de aceptación por área

| AREA | TESTS | PASS | FAIL | NOT VERIFIED | EVIDENCE |
|---|---:|---:|---:|---:|---|
| A. Correctness | 9 | 9 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| B. Leakage | 18 | 18 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| C. Reproducibility | 5 | 5 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| D. Search | 7 | 7 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| E. Walk-forward | 130 | 130 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| F. Metrics | 1 | 1 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| G. Accounting | 1 | 1 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| H. Cache | 2 | 2 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| I. Resume | 4 | 4 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| J. Persistence | 1 | 1 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |
| K. Scale | 4 | 4 | 0 | 0 | `scale-verification.json` |
| L. Failure handling | 1 | 1 | 0 | 0 | `unit-verification.json + validation-tests-final.txt` |

Los conteos por área agrupan los 175 casos nuevos; áreas C/I comparten pruebas, y Scale agrega cuatro campañas. Los 16 tests CL03 y ocho regresiones se cuentan adicionalmente en los 199. [verification.json](cl04/verification.json) enumera los 199 nombres y estado individual; [validation-tests-final.txt](cl04/validation-tests-final.txt) registra su ejecución, tiempos y cero skip.

| Criterio obligatorio | Estado | Evidencia |
|---|---|---|
| 1. known_answer | PASS | `validation-tests-final.txt` |
| 2. fold_oracle | PASS | `unit-verification.json` |
| 3. leakage_mutation | PASS | `unit-verification.json` |
| 4. metrics_oracle | PASS | `oracle.ts + independent-replay.json` |
| 5. accounting_reconciliation | PASS | `independent-replay.json` |
| 6. grid_random_budget | PASS | `unit-verification.json` |
| 7. cache_isolation | PASS | `validation-tests-final.txt` |
| 8. resume_failure_recovery | PASS | `validation-tests-final.txt` |
| 9. persistence_roundtrip | PASS | `independent-replay.json` |
| 10. traditional_nested_consistency | PASS | `same-winner-comparison/ + overfit-comparison/` |
| 11. qa_200_complete | PASS | `scale-200/load-verification.json` |
| 12. independent_replay | PASS | `independent-replay.json` |
| 13. strict_typecheck | PASS | `typecheck.txt` |
| 14. git_diff_check | PASS | `diff-check.txt + source-whitespace.json` |
| 15. baseline_production_preservation | PASS | `preservation.json` |

## Defectos demostrados y correcciones research

Evidencia inicial: [pre-hardening-tests.txt](cl04/pre-hardening-tests.txt), 0 PASS/6 FAIL; [pre-correlation-fix.txt](cl04/pre-correlation-fix.txt), 6 PASS/1 FAIL; [pre-csv-fix.txt](cl04/pre-csv-fix.txt), 7 PASS/1 FAIL. Mismas expectativas conservadas. Diff contra checkpoint: [research-hardening.patch](cl04/research-hardening.patch).

| Causa | Corrección acotada | Resultado posterior |
|---|---|---|
| Media redondeada generaba varianza espuria con retornos idénticos y Sharpe enorme. | Mismo estimador sample, trasladado al primer retorno; sin epsilon/floor. | Vol exactamente 0, Sharpe null. |
| Metrics aceptaba referencia/fees/exposición no finitos y overflow. | Validar inputs/resultado; selección rechaza métricas inválidas. | Rechazo explícito de NaN/Infinity e insolvencia de returns. |
| Fit/predict recibía parámetros POLICY, aunque la identidad de cache los excluía. | ModelSpec sólo MODEL; copias profundas congeladas y proyección a input_set. | Políticas separadas, same-model fit compartido. |
| JSON convertía NaN de estado cacheado a null silenciosamente. | Validación JSON plain/finito al escribir y leer. | Estado inseguro rechazado antes de persistir/consumir. |
| Hash de snapshot global invalidaba cache anterior tras mutar futuro. | Hash del information slice real para fit/prediction; snapshot completo permanece en identidad de campaña/job. | Artifacts previos conservados; mutación dentro del set recalcula. |
| Fallo de commit de job no dejaba evidencia durable. | Journal de job/summary commit fallido, abortar sin completado ficticio; incorporación a failures.csv al reanudar. | Journal conservado y recuperación sin repetir jobs completos. |
| Correlación de series constantes aparecía definida por redondeo de media. | Covarianza/varianzas trasladadas, misma fórmula. | Correlación null para constantes. |
| Writer CSV usaba LF, no CRLF RFC4180. | Atomic CSV con CRLF, quoting doble intacto. | Oracle byte-exact y round-trip independiente pasan. |

Engine version `capital-research-1.0.1`; versión de contrato cache separa artifacts viejos. También se registran gaps explícitos en folds.csv y se verifican cash, NAV, P&L de cantidades previas, exposición y fecha de fill en el adaptador. Telemetry queda fuera de economics. No se cambió selección económica, fórmula anualizadora, política real, costos del calculator ni convención de sleeves.

## Oráculos y pruebas

`research/capital/oracle.ts` no llama a helpers de folds/métricas/selección del engine. Usa aritmética entera año×12 para folds, identidad de varianza por pares y solución cerrada de NAV postfee: buy `(Npre+f*held)/(1+f*risk)`; sell `(Npre-f*held)/(1-f*risk)`. Compara cantidades, cash, fees, P&L y NAV con runBacktestEngine real; no se simula la función bajo prueba. NAV inicial 100, quantities mantenidas entre fills, señal filas < signalDate y ejecución en siguiente fila observada.

Known answers: activo de retorno constante, full risk, cash 0/positivo/negativo, 50/50 (+2% activo => +1% cartera antes de fees), activo flat; predictor perfecto causal, predictor inútil igual a su control de exposición, lectura futura rechazada, ties exactos turnover/complejidad/id. Cero vol, una observación, drawdown pendiente, retornos <=-100%, NaN/Infinity y fees 1000 bps cubiertos. Oráculos de metrics usan 252/n sesiones, desviación sample y retornos diarios en exceso de la referencia declarada; no CAGR/vol para Sharpe.

128 combinaciones outer de 2 modos × 2 windows × train 3/6/12/24 × test 1/3/6/12 × step test/test+3; variantes inner compatibles heredadas/rolling/expanding. Incluye único fold exacto, menos cobertura, huecos, leap year y rechazo de boundaries no month-start y overlaps. Gaps quedan explícitos. 16 mutaciones cruzan modos/windows/clocks once/monthly/quarterly/yearly; más tres cutoffs intrafold. Comparan fits, normalización, selección/ranking anterior, targets, trades/NAV previos y artifacts cache. Cambios dentro de training provocan misses.

Grid/random budgets 1/2/10/50/100/200, producto cartesiano y reducción por índices exactos, seed obligatorio, sin reemplazo, IDs estables y cambios económicos; cache de 20 políticas y cada dimensión de identidad, versión/input/transformation real, corruption y política distinta compartiendo fit. Resume tras 0/1/mitad/último job antes de summary preserva hashes y sólo ejecuta pendientes. Fallos invalid/fit/predict/backtest/write quedan retenidos; sin candidato elegible no hay winner inventado. Dos campañas con failures/invalids se conservan bajo `cl04/failure-*/` y pasan replay.

Se mantiene el fixture overfit CL03 y una variante independiente de nueve meses con dos indicadores QA. Traditional selecciona `c_d310bc5ad9ca942118d98e1d`; nested `c_46ab1aee0e69def9c45b39f3`; nested outer CAGR sintético ≈-68.1%, pese a inner score fuerte. Son respuestas esperadas de fixture, no estimaciones de alpha. Otra pareja elige el mismo candidato. Ambas parejas usan los mismos candidate definitions/data/costos/clocks pertinentes: [same-winner comparison](cl04/same-winner-comparison/comparison.json), [overfit comparison](cl04/overfit-comparison/comparison.json).

## Escala y persistencia

Spec QA separada: `cl04/scale-200/campaign.qa.json`, congelada antes de performance, no modifica budget-200 de CL03. 200 configuraciones únicas de target constante en fixtures baratos, mismo modelo QA; un outer/inner fold, costs 0/5 bps, max_jobs=500. Dry-run: 200 candidates, 1 outer, 1 inner, 2 fits, 402 backtests, total 404 jobs; ejecutados 402 backtests y 2 fits, sin saltar safety guard.

| Candidatos | Backtests previstos / ejecutados | Fits previstos / reales | Fit hit ratio | Run ms | Peak RSS MiB | Bytes motor antes de charts | Resume ms | Nuevos jobs resume |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 22 / 22 | 2 / 2 | 90.91% | 38.1 | 166.8 | 151284 | 15.7 | 0 |
| 50 | 102 / 102 | 2 / 2 | 98.04% | 216.5 | 221.7 | 748728 | 100.8 | 0 |
| 100 | 202 / 202 | 2 / 2 | 99.01% | 307.7 | 259.7 | 1768572 | 109.2 | 0 |
| 200 | 402 / 402 | 2 / 2 | 99.50% | 752.8 | 273.9 | 4717375 | 382.0 | 0 |

Peak RSS y tiempos son observaciones de QA en este entorno, no garantías de performance. Cada campaña tiene manifest, candidate-space, candidates/folds/inner/outer/selected/failures/OOS-ledger/OOS-equity/stability CSV, summary, REPORT y cinco charts. [scale-verification.json](cl04/scale-verification.json) incluye tamaño final con charts y hashes económicos. [config-data-manifest-hashes.json](cl04/config-data-manifest-hashes.json) y [research-code-hashes.json](cl04/research-code-hashes.json) congelan inputs/código. Config/data JSON fixtures son explícitamente SYNTHETIC; no reemplazan histórico.

## Replay independiente y reproducibilidad

`research/capital/replay.py` lee artifacts, sin llamar de nuevo al selector, folds o summarize del engine. Reconstruye folds por calendario, métricas desde ledger, ranking/constraints/ties, winners y composite exclusivamente outer. Verifica RFC4180 (outputs nuevos), row counts, IDs, filas inner sin outer, failed/invalid presentes, JSON finito round-trip, OOS sin fechas duplicadas y conciliación. 12 campañas PASS: cuatro scale, cuatro protocol/overfit, dos con fallos preservados y dos CL03 históricos de sólo lectura. [independent-replay.json](cl04/independent-replay.json) guarda reconstrucciones y hashes; 868 jobs auditados. No nuevo holdout histórico.

## Comandos y códigos de salida

[commands.json](cl04/commands.json) registra los comandos, cwd, códigos y evidencia. Build usa esbuild y dependencias existentes con alias DB del runner previo; tests por `node ...validation.test.js` desde la raíz: exit 0, 199 PASS. Ocho campañas QA exit 0; render/comparaciones exit 0; replay final exit 0; strict typecheck exit 0 y git diff --check exit 0. No instalación ni cambios de manifests/lockfiles.

Se preservan también errores de harness: primer typecheck del runner QA encontró un brace faltante (exit 2); una ejecución del fixture desde artifacts/api-server no encontró paths relativos de source (exit 1); primer replay asumió orden global de folds y encontró el formato CL03 intercalado (exit 1). Se corrigieron sintaxis/cwd/adaptación por claves semánticas, sin cambiar expectativas económicas ni ocultar fallos: `typecheck-first.txt`, `validation-runner-cwd-error.txt`, `replay-adapter-order-error.txt`. Reejecuciones finales PASS.

## Archivos y límites

Modificados contra checkpoint: cinco archivos research arriba. Agregados: `research/capital/qa.ts`, `oracle.ts`, `hardening-regressions.test.ts`, `validation.test.ts`, `qa-campaign.ts`, `replay.py`, `finalize-validation.py`, `reports/cl04/` y este reporte. El git diff tracked de calculator era previo a CL04 y su hash quedó idéntico.

- Fixtures deterministas sintéticos: certifican la mecánica cubierta, no rentabilidad ni robustez económica.
- Research index != continuous live account: sleeves independientes NAV=100/cash, entry costs, sin liquidación terminal ficticia.
- DSR = NOT_IMPLEMENTED; sin significancia estadística. El modelo financiero real sigue siendo únicamente current_regime.
- Plugins de research confiables: el API restringe filas/inputs y congela objetos; no es un sandbox OS frente a código que lea globals, disco o red deliberadamente.
- La corrupción cubierta es modificación sin hashes de integridad coherentes; hashes no son autenticación ante un adversario que reescriba también los hashes.
- Cash constante diario; no se valida una nueva serie histórica de cash ni la calidad económica/vendor de datos históricos.
- Clocks soportados por v1: rebalance mensual/trimestral; recalibration once/monthly/quarterly/yearly; ventanas en meses; overlaps rechazados explícitamente.
- Fallas de escritura inyectadas en commit de job y pausa antes de summary; sin simulación de power-loss/fsync, concurrent writers o daño arbitrario de filesystem.
- Peak RSS por proceso Linux incluye imports y resume; cuatro campañas de carga corrieron en paralelo. No es benchmark financiero ni stress de dataset completo.
- Archivos CL03 con LF permanecen congelados: su parsing/quoting round-trip pasa; CRLF RFC4180 se exige a outputs nuevos CL04.
- Tolerancias numéricas absolutas 1e-8 + relativas 1e-10, explícitas y sin relajarlas; ties se ordenan exactamente sin tolerancia.

La matriz obligatoria no tiene FAIL ni NOT VERIFIED; los límites anteriores son explícitos y no se convierten en claims adicionales. CL04 certifica las mecánicas y rangos ejercitados. CL01/02/03 permanecen como baseline; no se abre CL05.
