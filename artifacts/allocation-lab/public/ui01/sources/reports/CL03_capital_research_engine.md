# CL-03 — Capital Research Engine v1

**PASS de infraestructura y aceptación acotada.** Traditional y nested funcionan
con rolling/expanding; grid y random son reproducibles; se ejecutaron 16 tests
sintéticos y dos campañas reales pequeñas con definiciones idénticas. La campaña
de 200 quedó solamente preparada/dry-run. No se incorporaron otras familias ni se
presenta el resultado como descubrimiento de alpha.

## Identidad y conservación

`/workspace/Allocationlab`, remoto `juanser15/Allocationlab`, rama `work`, commit
`1163a0b574b573004372a3a2fc8752810dea7ef9`, conservados. CL-01/CL-02 y sus cambios
pendientes no se resetearon ni sobrescribieron. Se verificaron **61 hashes** de
producción, tests CL-01, reportes CL-01/CL-02, todos los archivos de `reports/cl02/`,
manifests y lockfiles: idénticos antes/después. Evidencia:
[CL03-protected-hashes.json](capital-research/CL03-protected-hashes.json).

Todo lo agregado es research-only: [código y guía](../research/capital/README.md),
[configs](../configs/capital-research/acceptance-nested.json) y resultados bajo
`reports/capital-research/`. Sin edición de calculator, rutas, optimizer, quality
gate, factores/alpha streams; sin servicios de producción, nuevas descargas,
deploy, push o merge. Se reutiliza el backtester corregido y el CSV de CL-02.

## Implementación

| Módulo | Responsabilidad |
|---|---|
| `research/capital/spec.ts` | Campaña declarativa, validaciones, folds calendarios, configuración canonizada/IDs, grid/reducción explícita y random seeded sin reemplazo |
| `registry.ts` | Interfaces separadas MODEL/POLICY; régimen actual stateless, banda de cash actual y target constante; identity como transformación real inicial |
| `storage.ts` | Escritura atómica, artefactos congelados, cache verificado y CSV RFC4180 |
| `engine.ts` | Traditional/nested, cortes as-of, fits/predictions compartidos, jobs resumibles, selección congelada y outputs/diagnósticos |
| `metrics.ts` | Métricas del ledger, constraints, ranking/tie-breakers y correlación de retornos alineados |
| `cli.ts` | Verifica hash del CSV, dry-run obligatorio y guard de jobs, hash de código/config/data previo a performance |
| `render.py` | Cinco gráficos por campaña, reporte y comparación traditional/nested |
| `engine.test.ts` | Fixtures sintéticos, incluidos fallos/invalidaciones e indicador deliberadamente overfit |

CandidateSpec contiene familia, input set, transformaciones, parámetros del
modelo, política/parametrización de exposición, rebalanceo y recalibración. El
analista edita JSON con templates/axes; no hay lista hardcodeada de 200 estrategias.
El activo de riesgo pertenece a la campaña y es el mismo para todos los candidatos.

La selección primaria y su escenario de costos se congelan antes de performance.
Se soportan net_sharpe, cagr, max_drawdown y return_drawdown_ratio. Constraints:
turnover bruto anualizado, límite absoluto de drawdown y exposición efectiva
media. Ties: menor turnover, menor complejidad por número de parámetros, candidate_id.
No se crea winner si no existe candidato elegible.

### Cortes y clocks

Training/normalización reciben solamente `training_start <= date < training_end`
y el cutoff del fit. Traditional simula recalibración as-of dentro del training;
nested rankea **solo resultados inner OOS agregados**, recomputando métricas de
sus retornos. Cada selección queda guardada antes de ejecutar outer. Los learned
parameters quedan congelados durante cada OOS; solo la inferencia/estado de mercado
usa nuevas observaciones disponibles antes de cada señal.

Los clocks son independientes: rebalance mensual/trimestral; recalibración
monthly/quarterly/yearly/once; walk-forward step y horizonte test en meses. Inner
window type hereda outer o se especifica. Rolling elimina historia vieja de fit;
expanding mantiene el inicio. Historia de mercado anterior puede servir para
warmup de indicadores, **no para fit/normalización** fuera del train window.

Se admiten pasos mayores que el horizonte, con gaps explícitos. Los tests
solapados se rechazan en v1 (`step >= test`), evitando duplicación de OOS. Se
generan solo horizontes completos. No se presupone que los cuatro clocks sean
mensuales.

### Cache, resume y contabilidad

Cache incluye data_hash, familia/versión, model_parameters, input_set,
transformations, training_start/end, information_cutoff/hash e identidad del fold.
La política no forma parte del modelo; veinte políticas comparten un fit por
information set (test: 3 fits para 20 políticas, 2 inner + 1 outer). Prediction
cache agrega cutoff/hash real de la señal. No cruza information sets diferentes.

Jobs particionados por experiment/candidate/outer/inner-or-stage/scenario y hashes
de identidad/contenido. Se conservan también inválidos y fallidos. Resume verifica
manifiesto e integridad y no repite jobs terminados; se separa telemetría de los
resultados reproducibles.

El motor contable sigue siendo `runBacktestEngine`: next_close con filas
estrictamente anteriores, SPY únicamente operado, D5 para costos sobre notional
real, slippage cero, sin shorts/apalancamiento/cap vinculante. Fees y NAV se
verifican en cada ledger. No se simula el backtester para pasar tests.

Convención v1 explícita: **sleeves de validación independientes**, cada uno con
NAV=100/cash y costos de entrada. No se simula una liquidación al cierre ni se
afirma una cuenta continua con posiciones arrastradas entre folds. El índice final
compone **solo outer OOS daily returns**; el ledger conserva los NAV/posiciones de
cada sleeve. CAGR usa 252/observaciones, no la annualización calendario CL-02.
Estas diferencias impiden presentar v1 como reproducción exacta de CL-02.

## Tests sintéticos: 16/16 PASS, 0 omitidos

Se ejecutaron antes de las campañas reales. Typecheck estricto: PASS, exit 0.

| Caso individual | Resultado |
|---|---|
| traditional/rolling y expanding: folds outer exactos | PASS |
| nested: inner dentro de outer training; herencia/override del tipo de ventana | PASS |
| grid, reducción explícita y límite de 200 | PASS |
| random: mismo seed, unicidad y seed obligatorio | PASS |
| candidate IDs estables con reorder de claves; cambian con configuración | PASS |
| outer test ausente de inner fit, normalización, ranking y generación | PASS |
| modificación futura no cambia selecciones pasadas, traditional/nested | PASS |
| rolling elimina observaciones viejas; expanding conserva training previo | PASS |
| clocks independientes de rebalance/recalibración/step/horizon | PASS |
| veinte políticas comparten un fit por conjunto de información | PASS |
| cache separa training bounds/cutoffs y detecta tampering | PASS |
| interrupción/resume, hashes de resultados estables y rechazo de config/data diferentes | PASS |
| inválidos y fallidos se guardan junto a winners y tampoco se reejecutan | PASS |
| cuatro métricas, constraints y todos los tie-breakers | PASS |
| concatenación usa solamente outer test returns, sin fechas duplicadas | PASS |
| fixture deliberadamente overfit: traditional mejor y nested outer degradado | PASS |

El fixture overfit planta dos indicadores exógenos sintéticos con relación
inestable: A funciona en 2020/2022, B solamente en 2021. No son model families
reales incorporadas al registry de aceptación. Traditional selecciona A y obtiene
outer CAGR **15,083%**; nested selecciona B con inner CAGR **7,173%**, pero outer
CAGR **−12,809%**. Se prueba una degradación visible, no se fuerza rentabilidad
positiva. [Evidencia](capital-research/synthetic-overfit-evidence.json).

## Aceptación real pequeña

Dos campañas con **las mismas cinco CandidateSpecs**, hash de definiciones común
`f6c6316d66c14f03ec9f3ce583ee6cef6bf5d427aa46fbbd37da06372f4a7d72`:

- cuatro bandas cash_min ∈ {0,1; 0,2}, cash_max ∈ {0,2; 0,4};
- un target constante de riesgo 1;
- una sola familia real: régimen actual; input informativo completo de 22
  instrumentos de CL-02; **SPY como única posición de riesgo**.

Datos: mismo CSV dataset 22, hash
`b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0`, cierres ajustados
con procedencia amplia no verificada. No se sustituyó por sintéticos ni se hizo
refresh. No es holdout nuevo. Cash/ref Sharpe cero constantes recuperados de CL-02.
Costos 0/5 bps por notional real, supuestos de research.

Outer rolling: train 24 meses, test/step 12 meses. Outer tests: **2022 y 2023**.
Inner rolling: train 12 meses, test/step 6 meses; 2 inner por outer, 4 en total.
Warmup 252 filas. Rebalance/recalibración mensual, con relojes separados. Métrica
primaria net_sharpe a 5 bps, constraints congelados en las configs.

| Campaña | Jobs terminados | Fits cacheados | Outer OOS observaciones por escenario | Estado |
|---|---:|---:|---:|---|
| Traditional | 24 | 50 | 501 | COMPLETE; 0 inválidos / 0 fallidos |
| Nested | 44 | 6 | 501 | COMPLETE; 0 inválidos / 0 fallidos |

Resultado outer OOS a 5 bps, mostrado como verificación del pipeline:

| Modo | CAGR, 252 sesiones | Sharpe neto | Vol. | Máximo DD | Índice final |
|---|---:|---:|---:|---:|---:|
| Traditional | 3,525% | 0,301 | 15,467% | −19,163% | 107,130 |
| Nested | 1,113% | 0,154 | 19,498% | −24,509% | 102,225 |

Traditional selecciona cash 10–40% para 2022 y target SPY=1 para 2023. Nested
selecciona target SPY=1 en ambos folds. Sus selection scores, ranks, cambios de
parámetros y métricas por subperíodo se guardan en los CSV. En nested, el score
inner del fold 2022 fue 1,971; el contraste con su outer test queda explícito.
Estas dos ventanas no acreditan robustez, significancia ni ventaja económica.

- [Traditional REPORT](capital-research/cl03-acceptance-traditional/REPORT.md)
- [Nested REPORT](capital-research/cl03-acceptance-nested/REPORT.md)
- [Comparación](capital-research/cl03-comparison/comparison.json)
- [Gráfico lado a lado](capital-research/cl03-comparison/traditional-vs-nested.png)

![Traditional y nested, mismos candidatos](capital-research/cl03-comparison/traditional-vs-nested.png)

Cada campaña tiene los 13 outputs mínimos solicitados, jobs completos y cache.
Se guardaron distributions/rankings de todos los candidatos, perdedores incluidos;
frecuencias por candidato/familia; costos/turnover; outer-result por subperíodo;
sensibilidad de vecinos numéricos y correlaciones **inner OOS alineadas** cuando
están disponibles. Traditional no inventa correlaciones OOS de candidatos no
testeados en outer. **DSR = NOT_IMPLEMENTED**, sin aproximación.

Los cinco gráficos por campaña existen: equity+DD outer, distribución, score
selection vs outer, frecuencia/estabilidad, heatmap. El contraste lado a lado
verifica igualdad de definiciones. CSVs mínimos hicieron round-trip correcto.

### Reutilización/reproducibilidad comprobadas en datos reales

Se reiniciaron ambas campañas con el mismo código/config/datos:
**0 nuevos jobs**, 24/44 reutilizados. Los hashes de **14 artefactos económicos y
manifiesto por campaña** permanecieron iguales, incluyendo summary, CSVs, todos
los resultados y selección. Solo cambia telemetría de invocación/progreso.
[CL03-resume-verification.json](capital-research/CL03-resume-verification.json).

Hash experiment traditional:
`22b8f015ac281c85598c9306c225a095233b3bbbf4796c0d97f35d782b0e9d47`.
Hash experiment nested:
`9fc46f1bfc7ec424f1440beb42be4ddb1e83496a4978e833e81351587ff18c5b`.
Cada directorio contiene `pre-performance-freeze.json`, `code-hashes.json`,
`campaign.frozen.json` y `manifest.json`, escritos antes de performance.

## Campaña preparada hasta 200: solo dry-run

[Spec budget-200](../configs/capital-research/budget-200.json) y
[dry-run](capital-research/cl03-budget-200-dryrun/dry-run.json).

200 configuraciones únicas de la política existente: 20 cash_min de 0,00 a 0,19,
10 cash_max de 0,20 a 0,65. Son **bandas distintas de exposición**, no modelos
nuevos ni réplicas con nombres distintos. Sus pares de exposiciones para scores
0 y 1 son diferentes; no se agrega una familia para llegar a 200. El registry real
sigue teniendo una sola familia. Ninguna performance de esos 200 se calculó.

| Estimación previa | Cantidad |
|---|---:|
| unique_candidates / Cartesian product | 200 / 200 |
| outer folds | 2 |
| inner folds totales | 4 |
| model fits, cota superior compartida | 6 |
| backtests, 200×4×2 + 2×2 | 1.604 |
| escenarios | 0 y 5 bps |
| jobs totales, backtests+fits | 1.610 |
| guard max_jobs de la spec | 100 |

`execution_allowed_by_limit=false`: ejecutar esa especificación falla por el guard.
Se verificó el rechazo (exit 1 esperado): **0 backtests**, sin jobs, cache ni
performance/summary creados. Solo quedaron plan e identidad previa, sin resultados.
Se requiere una decisión explícita de presupuesto en otra campaña antes de
ejecutarla. Predicciones cacheadas no se confunden con nuevos fits. Los borradores
de dry-run previos a estabilizar la telemetría/guard se preservaron como
`dry-run.draft-v*.json`; el plan vigente es `dry-run.json`, sin performance.

## Acceptance criteria

| # | Criterio | Estado / evidencia |
|---|---|---|
| 1 | Traditional WF | PASS; campaña COMPLETE y fixtures |
| 2 | Nested WF | PASS; inner-only ranking, campaña COMPLETE |
| 3 | Rolling | PASS; límites exactos y slices de fit verificados |
| 4 | Expanding | PASS; conservación de training inicial e inner override |
| 5 | Grid | PASS; 200 únicos y rechazo/reducción explícita de exceso |
| 6 | Random reproducible | PASS; seed obligatorio, mismo seed mismos IDs |
| 7 | Budget <=200 | PASS; guard 1..200, tests y plan real |
| 8 | Sin leakage train/inner/outer | PASS; tests de corte, mutación futura y selección congelada |
| 9 | Resume | PASS; pausa sintética, 0 nuevos jobs reales y hashes verificados |
| 10 | Persistencia completa | PASS; artefactos mínimos, perdedores/invalid/failed y caches |
| 11 | Reproducible por hash | PASS; identidad verificada y 14 artefactos estables por campaña |
| 12 | Tests obligatorios | PASS; 16/16 individuales, 0 omitidos |
| 13 | Aceptación end-to-end pequeña | PASS; 5 candidatos idénticos, 68 backtests en total |
| 14 | Dry-run hasta200 con costo computacional | PASS; plan 200/1.604/6/1.610, ejecución bloqueada |

## Comandos y códigos de salida

```sh
# cwd: /workspace/Allocationlab/artifacts/api-server
./node_modules/.bin/esbuild ../../research/capital/engine.test.ts ../../research/capital/cli.ts --bundle --platform=node --format=esm --packages=external --alias:@workspace/db=./src/lib/calculator.a1.db-shim.ts --outdir=dist/cl03
# cwd: /workspace/Allocationlab
node artifacts/api-server/dist/cl03/engine.test.js
node artifacts/api-server/dist/cl03/cli.js configs/capital-research/acceptance-traditional.json --dry-run
node artifacts/api-server/dist/cl03/cli.js configs/capital-research/acceptance-nested.json --dry-run
node artifacts/api-server/dist/cl03/cli.js configs/capital-research/budget-200.json --dry-run
node artifacts/api-server/dist/cl03/cli.js configs/capital-research/acceptance-traditional.json --run
node artifacts/api-server/dist/cl03/cli.js configs/capital-research/acceptance-nested.json --run
MPLCONFIGDIR=/tmp/allocationlab-cl03-mpl XDG_CACHE_HOME=/tmp/allocationlab-cl03-cache python research/capital/render.py reports/capital-research/cl03-acceptance-traditional reports/capital-research/cl03-acceptance-nested
MPLCONFIGDIR=/tmp/allocationlab-cl03-mpl XDG_CACHE_HOME=/tmp/allocationlab-cl03-cache python research/capital/render.py --compare reports/capital-research/cl03-acceptance-traditional reports/capital-research/cl03-acceptance-nested reports/capital-research/cl03-comparison
./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/capital/spec.ts research/capital/registry.ts research/capital/storage.ts research/capital/metrics.ts research/capital/engine.ts research/capital/cli.ts research/capital/engine.test.ts
git diff --check
```

Los comandos de tests, campañas pequeñas, gráficos, typecheck y checks finales:
**exit 0**. La invocación adicional de `budget-200.json --run` fue exclusivamente
una verificación del guard: **exit 1 esperado**, `1610 > max_jobs 100`, sin ejecutar
performance. Se repitieron los `--run` de aceptación exclusivamente para
verificar reuse, con 0 evaluaciones nuevas. Tests se ejecutaron inicialmente y
tras separar telemetría de resultados, con **16/16 PASS** en ambas ejecuciones.
No se cambiaron expectativas de CL-01 ni resultados CL-02.

Logs finales: `capital-research/CL03-tests.txt`, `CL03-typecheck.txt`,
`CL03-verification.json`; salidas transitorias originales en `/tmp/allocationlab-cl03-*`.
`git diff --check` y chequeo de whitespace de archivos nuevos: sin errores.

Limitaciones todavía explícitas: muestras pequeñas; dataset/procedencia y cash
de CL-02; universo aplicado retrospectivamente; única familia stateless real e
identity; learned parameters congelados en OOS; sleeves independientes, sin cuenta
continua; solapamientos rechazados; correlación traditional no disponible; DSR y
significancia no implementados. Nada de esto se disfraza de robustez económica.
CL-03 termina aquí, sin HMM ni nueva UI.
