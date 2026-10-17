# AL-02 — Risk Analytics & Exposure Controller Certification

**PASS: 15/15 criterios, 42/42 tests individuales, cero omitidos.** Analítica PIT y diagnóstico offline de seis ledgers CL02 congelados, sin backtest ni optimizer nuevo. Ocho scorecards completos (seis observados y dos referencias retrospectivas) y seis charts. [verification.json](al02/verification.json).

## Qué muestran los datos disponibles

B dynamic ofrece protección adicional frente a B_control de exposición constante: a 0 bps, vol 16.432% vs 16.728%, max DD -28.411% vs -29.331%, CVaR95 pérdida diaria 2.485% vs 2.524%. Las exposiciones medias efectivas son casi iguales (85.837% vs 85.838%), pero beta full es 0.83752 vs 0.85297. La beta en DD20 es 0.80132 vs 0.84038; Q1 es 0.79459 vs 0.84477. La variación temporal afecta el riesgo de los días extremos, no sólo el porcentaje medio invertido.

El costo de esa protección existe: CAGR 13.349% vs 13.417% a 0 bps y 13.332% vs 13.407% a 5 bps. Turnover bruto en toda la muestra 2.0870x vs 1.2586x a 5 bps; fees sobre notional real 137.69 vs 72.70 unidades del NAV inicial 100000. No son fees observados de broker: se mantienen los supuestos research CL02.

Contra el constant-beta diagnostic a beta media rolling63 de B ≈0.85629, B0 reduce DD (28.411% vs 29.419%) y vol (16.432% vs 16.789%), pero obtiene menor CAGR (13.349% vs 13.607%). La referencia es frictionless diaria, tiene distinto startup y no costos/trades observados; no constituye una comparación neta ejecutable ni una estrategia ex ante.

CAPM bajo RF=0 da intercepto anual pequeño positivo para B (2.348 bps a 0 bps; 0.916 bps a 5 bps), t-HAC≈0.107/0.041. TM gamma es negativo, t≈-0.524. Estos datos no justifican llamar al resultado alpha ni skill de timing. La curva B cambia el perfil condicionado de riesgo y sacrifica retorno; no se ha demostrado una fuente residual robusta. El risky q de B/B_control es siempre SPY, por lo que no hay allocation alpha por cambios de composición q en este replay.

## Scorecards observados y referencias

| Serie | CAGR calendario | Vol anual | Max DD | CVaR95 pérdida | Full beta | Media rolling63 beta |
|---|---:|---:|---:|---:|---:|---:|
| A_0bps | 15.559% | 19.604% | -33.717% | 2.950% | 0.99971 | 0.99999 |
| A_5bps | 15.551% | 19.604% | -33.717% | 2.950% | 0.99970 | 0.99999 |
| B_0bps | 13.349% | 16.432% | -28.411% | 2.485% | 0.83752 | 0.85629 |
| B_5bps | 13.332% | 16.432% | -28.411% | 2.485% | 0.83752 | 0.85629 |
| B_control_0bps | 13.417% | 16.728% | -29.331% | 2.524% | 0.85297 | 0.85781 |
| B_control_5bps | 13.407% | 16.728% | -29.332% | 2.524% | 0.85297 | 0.85781 |
| B_constant_beta_diagnostic_from_0bps | 13.607% | 16.789% | -29.419% | 2.526% | 0.85629 | 0.85629 |
| B_constant_beta_diagnostic_from_5bps | 13.607% | 16.789% | -29.418% | 2.526% | 0.85629 | 0.85629 |

| Serie | CAPM intercepto anual (bps) | t-alpha HAC | TM gamma | t-gamma HAC |
|---|---:|---:|---:|---:|
| A_0bps | -15.663 | -1.031 | 0.00127 | 0.802 |
| A_5bps | -16.348 | -1.034 | 0.00138 | 0.820 |
| B_0bps | 2.348 | 0.107 | -0.05449 | -0.524 |
| B_5bps | 0.916 | 0.041 | -0.05438 | -0.524 |
| B_control_0bps | -12.334 | -0.880 | -0.06286 | -1.470 |
| B_control_5bps | -13.197 | -0.910 | -0.06276 | -1.469 |

Los nombres constant-beta son **RETROSPECTIVE DIAGNOSTIC**, no reemplazan B_control. Alpha CAPM aquí es sólo el nombre de un intercepto residual del modelo explícito, no una afirmación de alpha económico. Sin score compuesto, ranking/selection objectives, hurdle 1% o significado automático por t>0/gamma>0.

## Estimación PIT y controller

`estimators.ts`: asset beta Cov(r_i,r_SPY)/Var(r_SPY), sample covariance T-1, misma información común para betas y covariance. Default 252 sesiones completas, benchmark SPY, returns diarios ajustados. Soporta sólo 63/126/252 declarados y minimum_observations configurable; no búsqueda/grid. Filtro estricto return.date < decision_date antes de validar/hashear valores, nunca datos posteriores. Ventana de las últimas sesiones previas, drop listwise de faltantes explícito; insuficientes/varianza mercado cero bloquean, sin epsilon en denominador. Per asset: beta/n/window/cutoff/benchmark/data hash/model/version. Beta sleeve=q' betas; vol anual=sqrt(252*q' covariance*q), mismo set.

El replay usa composeMandatedPortfolio original, sin editar AL01A. Targets fijos 0.30/0.50/0.70/0.90; q fijo SPY, CONTROLLED_08, CONTROLLED_12 y 50/50 SPY-TLT. CONTROLLED_08/12 son **SYNTHETIC derivados** 0.8/1.2×returns SPY, no instrumentos ni estrategias reales. SPY-TLT usa precios existentes y composición declarada, sin optimizar q. 87 fechas mensuales → 1392 composiciones; 302 INFEASIBLE por no leverage/constraints se conservan, sin clipping/fallback. Tabla guarda requested lambda, aplicada, cash, expected beta, cutoff/ejecución, hashes y failures.

Forward beta se mide en hasta 21 observaciones después del fill next_close, nunca en el estimator. Es proxy de returns diarios a q fijo, no nuevo book/trades. Estimada/forward permanecen separadas: SPY y controles lineales coinciden por construcción; el fixture cambia beta .8→1.2 y expected beta .6 se realiza .9. En q real SPY-TLT la diferencia absoluta media entre beta PIT/forward es ≈0.13958 (87 ventanas). No se garantiza realized beta por alcanzar el target estimado. El test VOLATILITY usa covariance PIT real para target=vol_sleeve/2, reconcilia lambda=.5/cash=.5/expected vol, no placeholder suministrado.

## Drawdown state y métricas

Nueva metodología **market-risk-metrics-1.1.0**; legacy AL01 1.0.0 queda idéntica. benchmark_state_history son todos los adjusted closes SPY disponibles desde 2010-10-01 hasta cada fecha. Running peak se actualiza causalmente sin reiniciar al comenzar la evaluation sample. Pares condicionados se limitan al sample, usando estado heredado previo. Test inicia debajo de un peak preexistente: DD5/DD10/DD20 oracle NumPy coincide y conteos difieren del reset legacy esperado. No se inventan peaks anteriores a la historia disponible.

Betas full/rolling63/rolling126/up/down/DD5/DD10/DD20/Q5/Q1 usan Cov/Var; rolling exige ventana completa. Tail threshold Type7 sobre muestra disponible, Q5/Q1 configuraciones declaradas; upside r_m>0 y downside r_m<0. Captures GEOMETRIC_SUBSET_DAILY_RATIO_V1: ratio de medias geométricas diarias en el mismo subset, no beta ni CAGR. Cada beta condicionada exporta n/status/reason; denominator var cero→INSUFFICIENT_DATA.

CAGR conserva CL02: (producto de 1+r_net)^(365.25/calendar_days)-1 desde intervalStart inicial 2019-06-28, no 252/n. Vol sample diaria×sqrt252. Max DD de patrimonio incluye inicial NAV. CVaR95 es **expected LOSS empírica** de peor 5% de masa ordenada, ponderando fraccionalmente el retorno de frontera; no se confunde con percentil ni promedio de todos los empates en VaR. Turnover bruto =Σ abs(actualnotional)/pretradeNAV, anualizado252/n, fees sumados desde trades/ledger. Target exposure/implied target cash, actual beginning exposure/cash, full beta y mean realized rolling beta se guardan por separado; promedio de beta no se sustituye por exposición.

## CAPM, TM y standard errors

CAPM: r_p-r_f = alpha_daily + beta*(r_m-r_f)+epsilon. TM agrega gamma*(r_m-r_f)^2. Fitting OLS con diseño centrado/escalado e inversión del Gram normalizado, luego transforma coefficients/covariance a unidades originales. Outputs coef diarios, alpha anual=252*intercepto, beta/gamma, SE/t, covariance, R², n/fechas/data hash/config/version. No se usan CAGR/vol para inferencia.

OLS homoskedastic usa SSE/(n-p)*(X'X)^-1. HAC Newey-West usa Bartlett w_l=1-l/(L+1), suma e_t e_(t-l)(x_t x_(t-l)' + transpuesta), sandwich (X'X)^-1 S (X'X)^-1. Default **L=5**, configurables, **sin corrección n/(n-p)**; opción de corrección explícita pasa test. OLS y HAC coinciden con SciPy SVD y un oracle independiente de matrix Toeplitz, no llamadas al core.

RF/cash son **constante cero research recuperada del manifiesto CL02**, no serie histórica T-bill. Se conserva ese supuesto en pares/manifest/scorecard. No se puede atribuir un resultado económicamente completo de cash/RF a estos inputs. No p-values, declaración automática de significancia, DSR o tuning.

## Capital efficiency y asimetría

return_per_unit_beta y cagr_per_average_beta = CAGR/media rolling63 beta realizada; volatility_per_unit_beta = vol/media beta. La media realizada rolling63 es retrospectiva y difiere de full beta cov/var y del proxy ex ante de exposición efectiva (SPY beta=1). Denominadores cero/casi cero (64*EPS)→INSUFFICIENT_DATA; overflow→NUMERICAL_FAILURE.

same-CAGR beta saving compara beta requerida por una referencia diaria frictionless SPY que iguala el CAGR con beta media de la cartera. Matching mediante 80 bisecciones, después de verificar crecimiento monotónico concavo en lambda∈[0,1]; no es un optimizer de q ni campaña/estrategia. Sin match factible retorna INSUFFICIENT_DATA. same-beta CAGR difference resta CAGR de esa referencia a lambda=beta media de la cartera. Son controles retrospectivos, no alpha; CAGR no se escala linealmente por beta.

Se exportan upside/downside beta ratio, downside-minus-upside, DD5/10/20 y Q5/1 term structures, upside capture - abs(downside capture). Son diagnostics, no objectives; no se presupone menor beta siempre mejor.

## Constant-beta diagnostic

Cada escenario B calcula target=media de sus rolling63 betas realizadas, observaciones válidas. Calibración al **2026-10-01**, después de terminar el sample; mandato/modelo no se backdatean a 2019. SPY risky sleeve beta PIT=1; controller produce lambda≈target y cash=1-lambda. Retrospectivamente se construye r_reference=lambda*r_SPY+(1-lambda)*RF, índice diario frictionless. Full beta y rolling beta coinciden con target dentro de tolerancia. No ledger/posiciones/trades/costos estimados: costs/turnover null. Startup distinto: CL02 empieza en cash y llena next_close, el control analítico parte expuesto. Se mantienen B_control originales; no nuevo backtest ni motor contable.

## Tests, correcciones y reproducibilidad

**42/42 PASS**, cero skip; [tests-final.txt](al02/tests-final.txt), [test-cases.json](al02/test-cases.json). Oracles independientes guardados en oracle-fixtures.json: NumPy cov/maximum.accumulate/quantile y SciPy lstsq-SVD, HAC Toeplitz; productos geométricos y soluciones aritméticas para captures/CVaR/controllers/efficiency. Tolerancia default tests abs1e-10+rel1e-8; cov SE abs1e-14+rel1e-8. Replay externo abs1e-9+rel1e-8.

Defectos nuevos demostrados conservan FAIL previo: ruido residual de roundoff generaba t-stats ficticios en control beta exacta (38 PASS/1 FAIL); config PIT NaN lanzaba en hashing y ratio podía retornar VALID Infinity (40 PASS/2 FAIL). Correcciones sólo research analytics: inference_status=INSUFFICIENT_DATA/t-stats null si ||residual||2<=64*EPS*p*||y||2, manteniendo coefficients; no hash ficticio para config inválida; overflow explícito. Regresión versionada **risk-attribution-regression-1.0.1**. No threshold económico, cambio de expectations o epsilon de market variance. Evidencia pre/post y manifests/resultados anteriores preservados bajo pre-inference-fix/ y pre-input-guard-fix/. Campos target/actual exposure aclarados con versión del manifiesto anterior preservada; valores financieros existentes no cambian.

[Independent verification](al02/independent-verification.json) reconstruye ocho scorecards, todas las rolling/conditional/capture métricas, CAPM/TM/HAC y fees/turnover desde artifacts, cero calls al core. Manifest congela código/data hashes/config **antes** de performance; repetir CLI con mismo manifest dejó todos los hashes económicos idénticos. Guards adicionales no alteraron economía válida. [reproducibility-verification.json](al02/reproducibility-verification.json).

## Archivos y comandos

Sólo agregados bajo `artifacts/api-server/src/lib/allocation-core/risk-analytics/`: estimators.ts, analytics.ts, diagnostics.ts, replay-cl02.ts, analytics.test.ts, prepare-inputs.py, independent-check.py, render.py. Reports nuevos AL02, sin editar AL01/CL/producción. Preservación: **2856/2856 archivos congelados idénticos**, incluyendo AL01 tests/código/reportes, calculator, CRE, optimizers, routes/UI/DB/manifests/lockfiles. Rama work, commit1163a0b574b573004372a3a2fc8752810dea7ef9; cambios previos pendientes conservados. [preservation.json](al02/preservation.json).

[commands.json](al02/commands.json) lista cwd/exits/evidencia: prepare-inputs.py exit0; esbuild existente exit0; Node tests exit0 42PASS; Node replay exit0 6ledgers/8scorecards/1392cases; independent-check exit0; render exit0 seis charts; strict tsc --strict/--noEmit exit0; git diff --check exit0. Whitespace de archivos nuevos comprobado adicionalmente. Typecheck inicial del runner encontró falta de anotación ReturnVector[] (exit2); corregida sin lógica económica, log conservado. Sin instalaciones ni conexiones de producción.

Outputs principales: metrics-cl02.csv, rolling-beta-cl02.csv, conditional-beta-cl02.csv, alpha-timing-cl02.csv, capital-efficiency-cl02.csv; además controller-replay.csv, pit-estimates.csv, scorecards.json, constant-beta-diagnostic.json, manifest y verificaciones. CSV RFC4180/CRLF; JSON finito. No score/ranking/winner.

## Gráficos

![Rolling beta](al02/charts/rolling-beta-dynamic-vs-constant.png)
![Upside downside](al02/charts/upside-downside-beta.png)
![Drawdown beta](al02/charts/drawdown-beta-term-structure.png)
![Tail beta](al02/charts/tail-beta-term-structure.png)
![CAGR beta](al02/charts/cagr-vs-average-beta.png)
![Attribution](al02/charts/dynamic-vs-constant-beta-attribution.png)

## Matriz de aceptación

| Criterio | Estado | Evidencia |
|---|---|---|
| 1. PIT beta estimator | PASS | `estimators.ts + 63/126/252 and mutation tests` |
| 2. Sleeve beta/covariance volatility reconcile | PASS | `q beta/vol tests + pit-estimates.csv` |
| 3. Existing exposure controller replay | PASS | `controller-replay.csv + 8 beta cases + vol case` |
| 4. Inherited benchmark drawdown state | PASS | `Inherited drawdown test + market-risk-metrics-1.1.0` |
| 5. Conditioned betas and captures known-answer | PASS | `8 conditional NumPy oracle tests + captures` |
| 6. CAPM OLS/HAC independent oracle | PASS | `4 OLS/HAC oracle tests + independent-verification.json` |
| 7. Treynor-Mazuy independent oracle | PASS | `SciPy/Toeplitz oracle + independent-verification.json` |
| 8. CVaR and capital efficiency | PASS | `CVaR/efficiency tests + capital-efficiency-cl02.csv` |
| 9. Six frozen CL02 ledgers replayed without backtester | PASS | `replay-verification.json` |
| 10. Retrospective constant-beta diagnostic | PASS | `constant-beta-diagnostic.json` |
| 11. No look-ahead in estimators/state | PASS | `Future mutations PIT/regression/state tests` |
| 12. Reproducible input/config/output hashes | PASS | `manifest.json + reproducibility-verification.json` |
| 13. Strict typecheck | PASS | `typecheck.txt` |
| 14. git diff --check | PASS | `diff-check.txt + source-whitespace.json` |
| 15. CL/AL01/production preservation | PASS | `preservation.json` |

## Límites explícitos

- Frozen adjusted-close snapshot provenance/dividend/vintage not independently certified; numerical PIT filtering only
- RF/cash reference 0 constant from CL02, not a historical Treasury series; economic alpha/cash inference limited
- Same previously analyzed 2019-2026 sample, not a new holdout or alpha discovery
- Counterfactual is retrospective daily constant-weight frictionless SPY index, no trades ledger/costs; startup differs from CL02 initial cash/next-close fills
- Forward controlled sleeve beta is a fixed-q daily-return risk proxy, not a new executed trading book
- Primary no-leverage controller may be INFEASIBLE; 302 such cases retained, no clipping
- HAC default lag 5/no finite-sample correction declared, no significance/multiple-testing claim
- Zero numerical residual leaves regression coefficients but no identifiable noise t-statistics
- Same-CAGR match is monotone frictionless SPY diagnostic on [0,1]; unavailable matches return INSUFFICIENT_DATA
- No optimizers/quality gates/UI/API/AL03 or production connection

PIT es certificación de filtrado/causalidad del motor sobre el snapshot provisto, no certificación de vintages/vendor/corporate actions del feed. Esta muestra ya fue analizada: no holdout nuevo, no claim de alpha o rentabilidad robusta. Risk management, capital efficiency, timing y retorno residual son conceptos distintos. Se termina AL02 sin abrir AL03.
