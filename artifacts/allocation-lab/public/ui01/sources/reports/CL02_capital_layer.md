# CL-02 — evaluación histórica acotada de cash versus SPY

Evaluación concluida con evidencia disponible. **A, B y el control retrospectivo de B: seis escenarios contablemente válidos, condicionados al snapshot. V1 y V3: BLOQUEADAS por definición incompleta.** No se eligió ganadora ni se ajustaron parámetros después de ver performance.

## Identidad, conservación y manifiesto previo

- Repositorio: `juanser15/Allocationlab`, ruta `/workspace/Allocationlab`, rama `work`, commit `1163a0b574b573004372a3a2fc8752810dea7ef9`.
- Al retomar: `calculator.ts` modificado por CL-01; ambos tests CL-01 y su reporte pendientes como archivos nuevos. Se conservaron íntegros. No hubo reset, checkout, sobrescritura de inputs ni cambios adicionales de producción.
- Se guardaron rama, commit, estado y patch CL-01 en `cl02/checkpoint.*`; hashes antes/después confirman idénticos `calculator.ts`, A1, ambos tests CL-01 y `CL01_capital_layer.md`. También se congelaron hashes de manifests y lockfiles, sin editarlos.
- Código de calculator utilizado: SHA-256 `c0e64df753f97c69390a146e72f05b5f1915e9f9532512e9076f6284677c57bc`.
- [Manifiesto](cl02/manifest.json): ID `4419fc3d9904ec01406d5813bc2c918c6db872f6ff61f9b7faf256b962f6478f`, congelado `2026-10-13T13:36:42.846Z`, **antes de performance**. La preparación emitió `performanceCalculated: false`.
- El manifiesto identifica datos/configuración/código por hashes, universo informativo y operado, parámetros, yield, referencia de Sharpe, calentamiento, fechas, candidatas bloqueadas y fórmulas de métricas. No existían resultados CL-02 antes de este bloque. Después se verificó reutilización de los seis ledgers con el mismo manifiesto, sin volver a ejecutar el motor histórico.

## Datos y cobertura

Se utilizó el CSV exacto del dataset **22**, dentro de `reports/oct2026-backtests/assets-preparation.response.json`, sin descargar datos ni sustituirlo por sintéticos. Copia extraída: [adjusted-closes.csv](cl02/adjusted-closes.csv).

- SHA-256 del CSV: `b4a4fa0e0ddb6f639521acbe7398740904860a933391081d06e783339e6c7bc0`; coincide con el snapshot.
- 4.023 observaciones, 2010-10-01 a 2026-09-30, SPY positivo y sin faltantes.
- Convención declarada: cierres ajustados persistidos; dividendos/ajustes incorporados según esa declaración. No hay serie separada de dividendos, contabilidad broker de corporate actions ni vintages históricos de publicación.
- **Proveedor del dataset amplio no verificado**, como declara `reports/oct2026-backtests/freeze.json`. No se afirma origen sintético ni autenticidad de mercado verificada. Resultados condicionados a este archivo, sin extrapolar su procedencia.
- Como corroboración limitada, los cierres SPY coinciden casi exactamente con el dataset 24 vinculado al refresh Yahoo local: 2.953 fechas comparadas, diferencia máxima absoluta 0,0002. No se reemplazaron precios. Esa coincidencia no autentica el resto del universo ni elimina la limitación de procedencia.
- El dataset D6 con tickers `D6A…D6E` se descartó para este experimento; no contiene SPY ni el universo requerido. El snapshot real de 12 ETFs tampoco sustituye al universo de régimen de 22 instrumentos.

La configuración recuperada es `reports/oct2026-legacy-sector-diagnostic/configuration-snapshot.json`; copia en [configuration.json](cl02/configuration.json). **Cash 10–20%**, no el preset default 50–60%. Universo informativo enabled conservado:

```text
XLK XLC XLRE XLI XLY XLF XLU XLE XLV XLB EEM EWJ AAXJ EWG EUFN
SPY GLD TLT IEF VNQ EFA DBC
```

EWC/EWB estaban deshabilitados y no se incorporaron. **Solo SPY es operado.** `computeRegime` recibe los 22 inputs; no se ejecuta `constructAllocation`, selección de ETFs, factores, quality gate u optimizador. El régimen SPY que el motor genera como metadato interno de rebalance no decide los targets de B: el régimen completo usado para la decisión está en `targets-B.json`.

### Ventana comparable

La ventana documentada usada como base es **2016-10-01–2026-09-30**, de `reports/oct2026-backtests/freeze.json`. No se la llama holdout nuevo.

XLC tiene su primera observación en **2018-06-19** y XLRE en **2015-10-08**. No hay cobertura suficiente del universo completo para evaluar la ventana solicitada desde 2016 con el calentamiento requerido. Se tomó el primer rebalanceo mensual documentado con **252 filas anteriores consecutivas válidas para los 22 instrumentos**, sin decidir el inicio por retornos:

| Frontera | Fecha |
|---|---|
| NAV inicial, cierre previo a la primera señal | 2019-06-28 |
| Primera señal, información hasta cierre anterior | 2019-07-01; cutoff 2019-06-28 |
| Primera ejecución | 2019-07-02, cierre |
| Final comparable | 2026-09-30 |
| Intervalos diarios por escenario | 1.823 |

La comparación acredita **el tramo cubierto**, no toda la ventana desde 2016. No se fabricó historia preexistente de XLC, no se redujo el universo informativo y no se agregaron ventanas ni grillas. La configuración/universo vigente se aplica retrospectivamente; no se dispone de un mandato de membresía histórica as-of.

## Reglas y protocolo congelados

- **A:** target SPY=1, sin timing de exposición. Mantenimiento mensual bajo el mismo protocolo; en la práctica solo tiene compra inicial, con cantidades mantenidas.
- **B:** regla actual del código, no identificada como V0 de otro informe. Se utiliza `computeRegime` real sobre filas `< signalDate` y el universo completo; el adaptador copia la expresión exacta de cash y verifica que exista en el calculator cuyo hash se congela:

  ```text
  cash = clamp(cashMin + (cashMax-cashMin)*0.5
               + ((50-composite)/50)*(cashMax-cashMin)*0.5,
               cashMin, cashMax)
  SPY = 1 - cash
  cashMin=0.1; cashMax=0.2
  ```

- **Control B:** target constante SPY=**85,8799582876%**, igual al promedio temporal de objetivos B postejecución desde el primer fill hasta el cierre final. Cada observación diaria tiene igual peso; no es el promedio simple de rebalanceos. Se conoce usando toda la ventana: **control retrospectivo, no estrategia ex ante**. Ambos esperan el mismo primer fill; la exposición media efectiva puede diferir por drift y no se fuerza a igualarla.
- **C / V1 vol-managed:** BLOQUEADA. No se recuperó archivo/input con definición completa, incluyendo `k`, estimador/ventana de volatilidad, límites y mapeo a cash. No se asumieron valores.
- **D / V3 tendencia:** BLOQUEADA. Falta definición completa de ventana/señal, umbrales y mapeo a cash. No se inventó una media móvil ni un filtro.

La búsqueda fue local y acotada: reportes y scripts existentes, docs/notas, texto adjunto y siete PDFs de committee/backtests. No se encontró la especificación V1/V3; la biblioteca de factores o nombres de versiones de otros bloques no la sustituyen. El bloqueo afecta solo a esas dos candidatas.

Protocolo común: mensual, `next_close`, filas `< signalDate`, NAV inicial **100.000**, cash inicial 100.000, sin holdings iniciales, sin shorts ni apalancamiento. Cantidades constantes entre fills. `d5GrossTradeCosts=true` usa la vía ya existente sobre notional absoluto y targets sin cap de turnover vinculante; no se construyó otro motor.

Costos: **0 o 5 bps por notional realmente comprado/vendido**, slippage adicional cero. Son supuestos de research, no costos observados. No se cambiaron convenciones del motor.

Yield recuperado de `freeze.json`: **dailyCashYield=0, constante**. Se conservó ese supuesto. No hay serie histórica remunerada de efectivo disponible. Por eso este es un diagnóstico bajo cash cero, no una evaluación del rendimiento histórico real del efectivo. La referencia de Sharpe también es cero constante, explícita; no se la presenta como tasa libre de riesgo histórica observada.

## Resultados recalculados desde el ledger

CAGR usa tiempo calendario: `(NAV_final/NAV_inicial)^(365.25/días)-1`. Volatilidad usa desvío muestral de retornos diarios × √252. Sharpe usa **media de retornos diarios en exceso de la referencia declarada / desvío muestral de esos excesos × √252**; no CAGR/volatilidad. Drawdown incluye el NAV inicial común. Todas estas métricas se recalcularon del ledger, y una segunda implementación Python verificó su concordancia; no se usaron las métricas agregadas del motor para la tabla.

| Caso | CAGR | Vol. anual | Sharpe | Máx. DD | Recuperación máx. DD | Exposición objetivo media* | Exposición efectiva media** | Turnover bruto | Costos en unidades NAV |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|
| A, 0 bps | 15,56% | 19,60% | 0,839 | -33,72% | 2020-08-10 | 99,95% | 99,89% | 1,000x | 0,00 |
| A, 5 bps | 15,55% | 19,60% | 0,838 | -33,72% | 2020-08-10 | 99,95% | 99,89% | 1,000x | 49,98 |
| B, 0 bps | 13,35% | 16,43% | 0,848 | -28,41% | 2020-08-06 | 85,83% | 85,84% | 2,087x | 0,00 |
| B, 5 bps | 13,33% | 16,43% | 0,847 | -28,41% | 2020-08-06 | 85,83% | 85,84% | 2,087x | 137,69 |
| Control retrospectivo B, 0 bps | 13,42% | 16,73% | 0,839 | -29,33% | 2020-08-06 | 85,83% | 85,84% | 1,259x | 0,00 |
| Control retrospectivo B, 5 bps | 13,41% | 16,73% | 0,839 | -29,33% | 2020-08-06 | 85,83% | 85,84% | 1,259x | 72,70 |

\* Promedio de target al cierre en fechas del ledger, incluyendo la espera inicial en cash. El target constante A es 100% al ejecutar; el control es 85,8799582876% después del fill. \** Valor SPY / NAV al inicio del intervalo; las exposiciones efectivas de cierre están separadas en CSV/gráfico. El redondeo de la tabla oculta diferencias pequeñas entre B y control. Turnover bruto = suma de notional absoluto real / NAV pretrade, incluye entrada y no usa mitad-L1.

[Tabla de precisión completa](cl02/metrics.csv), [métricas JSON](cl02/metrics.json), [contrastes](cl02/comparisons.json).

### Protección, retorno sacrificado y costos

Con 5 bps, frente a A:

- B reduce el máximo drawdown en **5,306 puntos porcentuales** y la volatilidad de 19,60% a 16,43%.
- Sacrifica **2,219 puntos porcentuales anuales de CAGR**; NAV final **248.029,20** versus **285.507,00**, o **13,127% menos patrimonio final**.
- Cobra **87,72** unidades NAV más en costos, pese a la menor exposición media, por sus cambios mensuales de objetivo y mantenimiento de pesos.

Frente al control retrospectivo de igual exposición objetivo media, con 5 bps:

- B reduce máximo drawdown en **0,920 puntos** y volatilidad de 16,73% a 16,43%.
- Tiene **0,0746 puntos anuales menos CAGR** y **0,476% menos NAV final**.
- Cobra **65,00** unidades NAV más; turnover 2,087x contra 1,259x.

Esto permite separar descriptivamente la reducción general de exposición del aporte incremental de su variación temporal. En esta muestra, el timing de B mejora algo la protección pero no aporta más CAGR que el control. **No se calcularon pruebas de significancia; no se afirma significancia, causalidad ni robustez económica.**

El cambio de 0 a 5 bps reduce el NAV final de A/B/control en aproximadamente **0,0500% / 0,1043% / 0,0629%**. Para B reduce CAGR en **0,0163 puntos anuales**. La suma nominal de fees no equivale al impacto compuesto sobre NAV final.

### Recuperaciones y pendientes

El máximo drawdown tiene pico 2020-02-19 y valle 2020-03-23 en los seis escenarios. A recupera en 173 días calendario desde el pico; B/control, en 169 días. Todos tienen además un episodio **pendiente** al 2026-09-30, desde el pico 2026-08-13: 48 días calendario / 33 observaciones hasta el final. A 5 bps, profundidades de ese episodio: A -3,063%, B -2,646%, control -2,635%. Una recuperación del drawdown máximo no significa que no haya otro drawdown pendiente. Cada archivo `*.drawdown-episodes.json` registra todos los episodios con pico, valle, recuperación o pendiente y duraciones.

## Evidencia y gráficos

- [Targets B y régimen completo](cl02/targets-B.json), [targets/cutoffs/ejecuciones B](cl02/targets-B.csv); cada escenario tiene además `*.targets.csv`.
- `*.ledger.jsonl`: ledger original del motor; contiene NAV, cash, posiciones, trades, costos, P&L y fechas de señal/fill.
- **`*.ledger.standard.csv`: exportación CSV estándar válida, recomendada para consumo.** Incluye los mismos datos y retorno, drawdown, exposición objetivo, efectiva inicial y efectiva de cierre.
- [Verificaciones contables](cl02/verification.json): **6/6 PASS, 1.823 intervalos por escenario**. Comprueban fees = suma de |notional real| × bps, precio real de fill, cantidades, P&L de holdings previos, cash/intereses, NAV/posiciones, target ejecutado una vez, ausencia de leverage/short y ausencia de trades entre fills.
- [Verificación independiente de métricas y CSV](cl02/metric-verification.json): **6/6 PASS**, incluyendo CAGR, volatilidad, Sharpe diario, drawdown, exposición, turnover y fees; round-trip CSV completo y fechas comparables.
- [Gráfico 0 bps](cl02/equity-drawdown-exposure-0bps.png) y [gráfico 5 bps](cl02/equity-drawdown-exposure-5bps.png): patrimonio, drawdown y targets separados de exposición efectiva. Gráfico 5 bps inspeccionado visualmente.

![Patrimonio, drawdown y exposición, 5 bps](cl02/equity-drawdown-exposure-5bps.png)

### Incidencias del runner de research, conservadas

La primera preparación falló por `spawnSync git EPERM` del entorno, sin calcular performance. Se guardó el checkpoint con comandos Git directos y el runner lo lee; no se cambió producción.

El renderer inicial falló al leer celdas JSON del CSV generado por el adaptador: el escapado era JSON, no RFC4180. Los ledgers JSONL y costos ya habían conciliado. Se preservaron el runner/renderer originales congelados y esos CSV como evidencia diagnóstica; **los `*.ledger.csv` iniciales no deben tratarse como CSV estándar**. `export-and-plot.py` genera `*.ledger.standard.csv` desde el JSONL, verifica su round-trip y calcula métricas independientemente, sin volver a ejecutar el backtester ni cambiar targets/params. [Manifiesto de postprocesamiento](cl02/postprocessing-manifest.json) registra código e inputs de esa corrección de exportación. Esto no invalida los resultados netos, cuyo ledger y fees pasaron todas las verificaciones.

## Comandos y cierre

Solo lecturas locales, sin servicios de producción ni nuevas descargas. La preparación guardó manifest y targets antes de ejecutar performance. Runner reproducible:

```sh
# cwd /workspace/Allocationlab/artifacts/api-server
./node_modules/.bin/esbuild ../../reports/cl02/research-runner.ts --bundle --platform=node --format=esm --packages=external --alias:@workspace/db=./src/lib/calculator.a1.db-shim.ts --outfile=dist/cl02-research.mjs
# cwd /workspace/Allocationlab
node artifacts/api-server/dist/cl02-research.mjs --prepare
node artifacts/api-server/dist/cl02-research.mjs --run
MPLCONFIGDIR=/tmp/allocationlab-cl02-mpl XDG_CACHE_HOME=/tmp/allocationlab-cl02-cache python reports/cl02/export-and-plot.py
sha256sum -c /tmp/allocationlab-cl02-preserve.sha256
git diff --check
```

| Ejecución | Código / resultado |
|---|---|
| Bundling esbuild | 0 |
| Primer prepare con subprocess Git | 1, EPERM; sin performance ni manifiesto |
| Prepare con checkpoint directo | 0; manifiesto previo, performanceCalculated=false |
| Run histórico | 0; A/B/control × 0/5 bps, 6/6 conciliados |
| Renderer inicial `python reports/cl02/render.py` | 1, escapado de CSV; no resultado neto inválido |
| Exportación estándar/verificación/gráficos | 0; 6/6 métricas y CSV PASS |
| Run repetido con mismo manifiesto | 0; 6/6 ledgers reutilizados, no backtest reejecutado |
| Hashes CL-01 y diff check | 0; conservación intacta, sin errores de whitespace |

Salidas transitorias: `/tmp/allocationlab-cl02-run.log`, `/tmp/allocationlab-cl02-reuse.log`, `/tmp/allocationlab-cl02-export.log`. Identidad inicial se confirmó con `git remote -v`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short`; checkpoint con esos comandos y `git diff -- artifacts/api-server/src/lib/calculator.ts`. No se repitió onboarding ni auditoría general.

Archivos agregados: este reporte y `reports/cl02/` (runner/adaptadores, manifiestos, checkpoint, datos/config extraídos, targets, ledgers, métricas, verificaciones, episodios y gráficos). No se editó producción, tests CL-01, manifests o lockfiles; sin push, merge, deploy ni conexión a servicios de producción.

Limitaciones/bloqueos restantes: V1/V3 sin definición completa; período 2016–2019 sin calentamiento del universo completo; proveedor amplio no verificado; configuración/universo aplicados retrospectivamente; revisión de adjusted prices no controlada por vintage; efectivo y referencia Sharpe cero constantes, no serie histórica; costos de research; control B retrospectivo; sin significancia calculada. Evaluación CL-02 terminada, sin ampliar el alcance.
