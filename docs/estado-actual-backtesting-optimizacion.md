# Allocation Lab v2 — estado del optimizador, factores y backtesting

**Fecha de inspección:** 24 de septiembre de 2026.  
**Propósito:** documento técnico-funcional para revisión por otro agente. Describe qué ejecuta el código actual, qué es solamente una etiqueta/preset, qué información falta y qué propondría construir. **No es una especificación aprobada ni una recomendación de inversión.**  
**Alcance:** código de este workspace y lecturas GET del entorno de desarrollo. No se ejecutaron nuevas optimizaciones, cargas de datos ni cambios de configuración para elaborar este documento. Las rutas y líneas citadas son las observadas en esta revisión; pueden desplazarse con ediciones posteriores.

## 1. Resumen ejecutivo: respuestas a las preguntas

| Pregunta | Respuesta actual |
|---|---|
| ¿El sistema decide autónomamente qué señales/factores usar? | **No.** Se guarda una biblioteca con estados `active`, `candidate` y `disabled`; el usuario define cuáles están activos. El cálculo usa solo `enabled && status === "active"`, excluye valores no calculables y renormaliza los pesos disponibles dentro de la fecha/régimen. Eso no equivale a seleccionar automáticamente los factores por valor predictivo. |
| ¿Puedo agregar factores? | **Sí, dentro de tipos de cálculo ya implementados y alimentados por precios.** Se pueden crear definiciones, editar lookback, lag, dirección, normalización, pesos y benchmark. El campo `formula` es texto descriptivo: escribir una fórmula nueva no la hace ejecutable. Series fundamentales/externas y el tipo `unsupported` no se convierten en señales operativas. |
| ¿Hay Minimum Variance, Risk Parity y mix de modelos? | **No como constructores de cartera operativos.** Solo el modelo A, score/rules-based Momentum/Trend, produce la asignación. La selección de covarianza sample/EWMA/shrinkage cambia un **diagnóstico de riesgo**, no el método que asigna pesos. MinVar, Risk Parity, mix/ensemble y desacuerdo entre modelos son fichas explicativas o capacidades pendientes. «Disparity» no es un modelo implementado identificable; confirmar si el término significa Risk Parity, máxima diversificación u otra cosa. |
| ¿Qué backtest hay? | Un backtest histórico de **un único constructor**, con señales de factores/régimen recalculadas en cada rebalance usando precios anteriores a la fecha de señal; aplica pesos, límite de turnover, costos, slippage simplificado y retornos diarios. Incluye curva, benchmark opcional, métricas, cortes cronológicos, grilla de sensibilidad y checklist de integridad. Tiene limitaciones de ejecución y validación que se detallan abajo. |
| ¿Hay atribución de P&L/riesgo por activo, factor, señal, sector, país, estilo? | **Parcial, en superficies distintas.** Hay atribución realizada posterior a una sesión por ETF y efectivo, correlaciones de buckets factoriales con retornos, y descomposición de riesgo actual por ETF/sector. No hay un ledger diario reconciliable **del backtest** con P&L por señal/factor/segmento/país/estilo; tampoco datos históricos de país/estilo suficientes para afirmar esos desgloses. |

**Clasificación:** Allocation Lab v2 es un constructor de asignaciones ETF y backtester integrado con UI propia, no una Strategy Factory genérica ni una UI de Signal Hub. El término «optimizer» es el nombre del producto: la asignación actual es una heurística determinista de ranking/pesos, no la solución de una función objetivo cuadrática. Fuentes: `artifacts/api-server/src/routes/run.ts:99-217`, `artifacts/api-server/src/lib/calculator.ts:627-655`, `artifacts/allocation-lab/src/components/portfolio-lab/ModelsTab.tsx:29-80`.

## 2. Arquitectura, pantallas y secuencia real

### 2.1 Componentes y rutas visibles

- Frontend React en `artifacts/allocation-lab`; API Express en `artifacts/api-server`, montada bajo `/api`; PostgreSQL para precios, configuración y sesiones. Las rutas se registran en `artifacts/api-server/src/routes/index.ts:1-44`.
- Navegación principal actual: **Dashboard**, **Portfolio Lab** e **Investment Committee**. Settings/Configuration es un drawer desde el encabezado. Las URL antiguas `/research-lab`, `/backtesting`, `/market-monitor` redirigen a Portfolio Lab; `/reports` y `/archive` a Investment Committee; `/settings` y `/configuration` a Dashboard. No constituyen apps independientes. `artifacts/allocation-lab/src/App.tsx:25-49`, `artifacts/allocation-lab/src/components/layout/Sidebar.tsx:10-14`.
- En Portfolio Lab los cinco tabs activos son **Overview**, **Factors & Regimes**, **Models**, **Backtest** y **Allocation**. Hay botones de cabecera **1 · Optimize** y **2 · Validate**. `artifacts/allocation-lab/src/pages/portfolio-lab.tsx:93-124,167-220`.

### 2.2 Qué dispara cada botón

1. **Optimize** hace `POST /api/run` con cuerpo vacío. El backend toma la configuración y el CSV persistidos **en ese momento**, calcula resultado y lo guarda como sesión. En éxito, la UI relee `GET /api/results/latest` y, si tiene `sessionId`, intenta crear un snapshot de gobernanza en una llamada posterior (origen declarado, benchmark, etiquetas de versión y supuestos de ejecución tomados de ajustes locales). El guardado de sesión y el snapshot de gobernanza **no son una transacción atómica**. `artifacts/allocation-lab/src/pages/portfolio-lab.tsx:58-81`; `artifacts/api-server/src/routes/run.ts:181-217`.
2. **Validate** requiere que exista una sesión de optimización para habilitar el botón en la UI, cambia al tab Backtest y solicita/refresca `GET /api/backtest`. El endpoint **no reproduce los inputs exactos de la sesión mostrada**: lee el último CSV y la configuración **actual** de universo, restricciones y factores. Por eso un backtest ejecutado después de editar factores o subir otro CSV puede no validar la asignación de aquella sesión. `artifacts/allocation-lab/src/pages/portfolio-lab.tsx:33-56,84-91,112-120`; `artifacts/api-server/src/routes/backtest.ts:63-68,102-132`.
3. Los badges «Data, Factors, Regime, Models, Validation, Robustness, Constraints, Allocation» reflejan hitos/estado de la UI; **«Models» marcado no significa que los tres modelos estén calculados**. `artifacts/allocation-lab/src/pages/portfolio-lab.tsx:139-165`.

### 2.3 Tabs del producto, punto por punto

| Superficie | Qué hace de verdad | Límite relevante |
|---|---|---|
| **Dashboard** | Consulta estado de precios, última sesión/archivo, diagnóstico de riesgo, backtest y preparación de operaciones; permite revisar sesión histórica, régimen, cash, ETFs activos, asignación, watchlist y KPIs. | Es principalmente una vista de revisión; un KPI histórico que consulta backtest actual no es necesariamente un backtest congelado de la sesión archivada. `artifacts/allocation-lab/src/pages/dashboard.tsx:40-69,179-400`. |
| **Portfolio Lab · Overview** | Resumen de última corrida: régimen, métricas, asignación sugerida, movimientos/watchlist y estado de validación; ofrece navegación a los otros tabs. | Antes de cargar datos o correr el optimizador hay estados vacíos; validación requiere solicitud separada. Algunos textos promocionan un ensemble que todavía no computa. `artifacts/allocation-lab/src/components/portfolio-lab/OverviewTab.tsx:97-101,150-202,248-300`. |
| **Factors & Regimes** | CRUD local en borrador de definiciones; Save persiste biblioteca; alta/edición/baja; tabs internos **Active / Candidate / Disabled**, historia y restauración versionada; heatmap del resultado guardado y matriz de correlación; muestra régimen y componentes. | «Guardar biblioteca» cambia **futuras** corridas, no una sesión ya guardada. El heatmap de un resultado anterior no recalcula nuevos factores. No hay selección automática ni fórmula libre ejecutable. `artifacts/allocation-lab/src/components/portfolio-lab/FactorsRegimesTab.tsx:98-185,269-419,426-498`. |
| **Models** | Model A muestra salida real y diagnósticos. El selector de covarianza sample/EWMA/shrinkage consulta el risk model. | Model B Minimum Variance y C Risk Parity están señalados `requires_extension`; no hay selección de constructor ni mix. La función objetivo escrita para A es descriptiva, no un solver del backend. `artifacts/allocation-lab/src/components/portfolio-lab/ModelsTab.tsx:29-80,171-210,260-336`. |
| **Backtest** | Formulario de benchmark, frecuencia, timing, bps de costo/slippage, rendimiento de cash y fechas; resumen, curva, retornos mensuales, folds, bias audit, panel de robustez y Scenario & Stress Lab embebido. | No guarda el backtest como versión inmutable de una sesión; la mayoría de tests A–G de robustez son descripciones/estados pendientes, no métricas ejecutadas. `artifacts/allocation-lab/src/components/portfolio-lab/BacktestTab.tsx:78-95,189-277,294-610`. |
| **Allocation** | Auditoría de restricciones, pesos de universo/cartera, cambios vs anteriores, scores, diagnóstico de riesgo y vínculo hacia implementación/comité. | El rótulo «Ensemble portfolio weights» no implica mezcla entre modelos: hay una sola asignación calculada. `artifacts/allocation-lab/src/components/portfolio-lab/AllocationTab.tsx:235-382,382-500`. |
| **Investment Committee** | Decision Room, análisis de comité a demanda, reportes, archivo/comparación y gobernanza; su atribución realizada revisa sesiones y precios posteriores. | No convierte automáticamente la atribución posterior a una sesión en atribución diaria del backtest. `artifacts/allocation-lab/src/pages/investment-committee.tsx:119-235`; `artifacts/api-server/src/routes/attribution.ts:43-255`. |

### 2.4 Settings que afectan al proceso

El drawer incluye **Data Sources, Universe, Portfolio Constraints, Previous Weights, Execution Assumptions, Model & Factors, Benchmarks, Reporting Defaults, Governance & Advanced y Onboarding & Demo** (`artifacts/allocation-lab/src/components/settings/SettingsDrawer.tsx:25-50`).

- **Data Sources:** carga CSV o consulta Yahoo Finance; ambos persisten CSV en el backend. La descarga permite resultados parciales y usa cierres ajustados preferentemente. `artifacts/api-server/src/routes/prices.ts:52-99`, `artifacts/api-server/src/routes/live-prices.ts:13-56,90-122`, `artifacts/api-server/src/lib/yahoo.ts:37-58`.
- **Universe/Previous Weights:** ticker, nombre, sector, habilitación y peso previo; **Constraints:** cash min/max, peso máximo ETF, score mínimo, número objetivo de ETF y switch de diversificación. Guardar esto afecta futuras corridas; no reescribe resultados antiguos. `artifacts/api-server/src/routes/universe.ts:12-78`, `artifacts/api-server/src/routes/constraints.ts:12-64`.
- **Model & Factors:** selector rápido que cambia `enabled`/`status` y guarda la **misma** biblioteca backend que Factors & Regimes; no es un segundo sistema local ni una selección temporal por corrida. Obliga a al menos un factor activo antes de guardar. `artifacts/allocation-lab/src/components/settings/sections/ModelFactorsSection.tsx:26-93,136-187`.
- Execution Assumptions, Benchmarks, Reporting Defaults, Governance y preferencia Demo se administran en `localStorage` como valores del navegador. **No suponer que cada ajuste de Settings gobierna el cálculo del backtest actual**: los controles del tab Backtest tienen su propio estado y pasan parámetros a la API; gobernanza se copia a snapshots cuando se crea una versión. `artifacts/allocation-lab/src/lib/local-settings.ts`, `artifacts/allocation-lab/src/pages/portfolio-lab.tsx:33-77`.

## 3. Fuentes de datos y persistencia: qué es real y qué no

| Fuente | Uso actual | Qué persiste / falta |
|---|---|---|
| CSV de usuario o Yahoo | Precios para régimen, factores, optimización, backtest, análisis posteriores. | PostgreSQL `price_data`: texto CSV, tickers, inicio/fin, número de filas y fecha de subida. Se usa **la fila cargada más recientemente**. La tabla no guarda el tipo de origen por fila ni un hash/identificador inmutable del dataset vinculado a cada corrida. `lib/db/src/schema/priceData.ts:3-10`, `artifacts/api-server/src/routes/prices.ts:13-19`. |
| Configuración | Universo, pesos previos, restricciones, biblioteca/versiones de factores. | `config` de PostgreSQL para configuración operativa. Algunos ajustes no operativos son `localStorage` del navegador. `artifacts/api-server/src/routes/universe.ts`, `artifacts/api-server/src/lib/factor-library.ts:91-99,143-168`. |
| Corridas | Resultado de `/run` (régimen, scores, pesos, diagnósticos, watchlist y factor set/version). | Tabla `sessions`, resultado JSONB y fecha. Puede haber enriquecimiento de gobernanza separado. `lib/db/src/schema/sessions.ts:3-12`, `artifacts/api-server/src/routes/run.ts:181-217`. |
| Backtest | Cálculo solicitado vía GET con config/datos actuales. | Respuesta con curva y métricas; **no existe snapshot persistido de cada ejecución de backtest** comparable por estrategia/fecha. `artifacts/api-server/src/routes/backtest.ts:47-176`. |
| Metadatos de país, estilo, signal lineage | No aparecen como dataset histórico verificable para atribución point-in-time. | `sector` es una etiqueta de universo/asignación, no un esquema de clasificación histórica completo. No atribuir retornos a país/estilo sin fuente, fecha efectiva y reglas de clasificación. |

El CSV se parsea suponiendo fecha en primera columna y símbolos en las demás; precios no numéricos/no positivos se omiten y filas se ordenan por fecha como texto. No hay ingesta institucional que garantice fechas únicas, calendario, divisa, corporate actions verificadas, gaps, volumen/ADV o universo libre de supervivencia. `artifacts/api-server/src/lib/calculator.ts:174-205`. Una descarga de Yahoo puede ser dato de mercado externo, pero el CSV actual **no permite demostrar criptográficamente su origen**. «Demo mode» es una preferencia UX, no una garantía de que los precios persistidos sean falsos o reales.

## 4. Pipeline actual de selección y optimización

### 4.1 Universo y elegibilidad

`POST /api/run` exige un CSV más reciente; lo parsea; intersecta tickers habilitados en el universo **actual** con columnas de ese CSV. Si no hay intersección, devuelve error. El universo de fábrica contiene ETF sectoriales e internacionales con estados iniciales y prior cash 54%, pero el usuario puede actualizarlo. Los defaults de restricciones son cash 50–60%, peso ETF 10%, score mínimo 5, objetivo 8 ETF y diversificación habilitada: **defaults, no valores obligatorios actuales**. `artifacts/api-server/src/routes/run.ts:99-125`, `artifacts/api-server/src/routes/universe.ts:12-33`, `artifacts/api-server/src/routes/constraints.ts:12-19`.

### 4.2 Régimen — función y umbrales

`computeRegime` se ejecuta **antes** de `computeFactors`; no depende de qué factores se activaron. Calcula trend por medias móviles, breadth por proporción de avances, volatilidad de retornos y un **proxy** de liquidez basado en dispersión de retornos; además proxies credit (XLF), commodities (XLE/XLB), cross-asset (correlación). Dollar, rates y earnings revision no tienen series requeridas y se señalan no disponibles en la implementación actual. Repondera los componentes disponibles con ponderaciones fijas: trend .25, breadth .20, vol .20, liquidity .10, credit .10, commodities .08, cross-asset .07. Etiquetas: `>=70 Risk-On`, `>=55 Constructive`, `>=40 Neutral`, `>=25 Cautious`, resto `Risk-Off`. `artifacts/api-server/src/lib/calculator.ts:488-608`.

El factor set solo tiene tres familias de pesos por régimen: `risk_on` para Risk-On/Constructive, `risk_off` para Risk-Off y `neutral` para los demás (incluido **Cautious**). «Régimen» no equivale a un feed macro externo ni a un selector automático de biblioteca. `artifacts/api-server/src/lib/factor-library.ts:178-188`.

### 4.3 Biblioteca de factores: presets, alta y semántica

La biblioteca default v1.0 incluye Momentum 120d (25%), Trend Quality 120d (20%), Volatility 60d (15%), Drawdown/Risk Fit 252d (15%), Mean Reversion 5d (5%), Relative Strength vs SPY 63d (10%) y Diversification Benefit 120d (10%). En una instalación ya usada **puede haber otra versión/estados**, por lo que estos son presets iniciales y no la configuración vigente. `artifacts/api-server/src/lib/factor-library.ts:54-83`.

La definición editable incluye id, nombre, familia, estado, `enabled`, `calculationType`, `formula` textual, `inputSeries`, dirección, lookback, lag, normalización, winsorization, tratamiento de faltantes, peso base, pesos por régimen, regímenes habilitados, fuente declarada y benchmark. El CRUD usa `GET/PUT /api/factors/library` y `POST /api/factors/library/restore/:version`; guarda JSON versionado en configuración, conserva hasta 50 revisiones y restaurar crea una **nueva versión**. Exige ids únicos y al menos un factor activo con peso positivo. `artifacts/api-server/src/lib/factor-library.ts:12-37,143-176`, `artifacts/api-server/src/routes/factors.ts:13-32`.

| `calculationType` operativo | Señal numérica que calcula el motor hoy |
|---|---|
| `momentum` | Retorno sobre lookback, aplicando lag. |
| `trend_quality` | Correlación al cuadrado de precios **en nivel** contra tiempo. La descripción de preset habla de log-precio y signo de la pendiente; el método actual no conserva ese signo: una caída lineal puede mostrar R² alto. |
| `volatility`, `drawdown` | Volatilidad realizada y pérdida pico-valle; `direction` puede invertir la preferencia numérica. |
| `mean_reversion` | Retorno de corto plazo negado. |
| `relative_strength`, `residual_momentum` | Diferencia entre retorno del ticker y retorno del benchmark configurado; no hay una regresión residual para `residual_momentum`. |
| `return_over_volatility`, `ma_distance` | Retorno/volatilidad y distancia del último precio respecto de media. |
| `diversification_benefit`, `correlation_stability` | Uno menos media de correlaciones con otros tickers; `correlation_stability` comparte implementación, no estima por separado estabilidad temporal. |
| `drawdown_recovery`, `downside_beta` | Recuperación relativa a drawdown y sensibilidad a días de benchmark negativo con la fórmula implementada. |
| `unsupported` | No calcula señal. |

`artifacts/api-server/src/lib/calculator.ts:322-414`; `artifacts/api-server/src/lib/calculator.ts:260-275`. **Una definición nueva sí puede usar los tipos anteriores**, con precio y benchmark suficiente. No hay intérprete de fórmulas: `formula` y `inputSeries` no conectan automáticamente una serie externa ni ejecutan expresiones. La cobertura de biblioteca es aproximada/global (historia disponible y benchmark) y no equivale a verificar suficiencia por fecha/ticker. Winsorization configurada y ciertas opciones de imputación no intervienen efectivamente en el cálculo actual; no asumir que configurar esos campos cambia las salidas. `artifacts/api-server/src/lib/factor-library.ts:101-113`; `artifacts/api-server/src/lib/calculator.ts:347-458`.

Después de obtener valores crudos, se aplica `direction`, normalización cross-sectional percentile 0–100 o z/robust-z limitado a 0–100; un único valor válido recibe 50. Solo `enabled && active` entra en scoring. Para el régimen del día, se ponderan factores calculables con pesos efectivos renormalizados entre los disponibles; faltantes no aportan. **No hay búsqueda predictiva, selección por rendimiento histórico, control automático de redundancia o prueba de significancia.** Campos legacy `mom20/mom60/mom120/mom252` de la respuesta pueden repetir el primer factor tipo momentum, no cuatro cálculos independientes; usar `factorContributions` y el snapshot real para auditoría. `artifacts/api-server/src/lib/calculator.ts:287-299,416-479`.

### 4.4 Constructor de pesos, reglas y fallos potenciales

`constructAllocation`:

1. Calcula un cash objetivo entre `cashMin` y `cashMax` según composite del régimen; resto es presupuesto invertible.
2. Deja elegibles ETF habilitados con composite de factores `>= minInclusionThreshold`.
3. Ordena descendentemente por composite y toma hasta `targetActiveEtfs`; **no garantiza** llegar a esa cantidad si faltan candidatos.
4. Reparte presupuesto entre seleccionados proporcionalmente al score (o uniforme si score total 0); limita pesos; opcionalmente combina **70% del peso de score + 30% del peso previo** en los nombres seleccionados; normaliza al presupuesto. Guarda pesos, cambios, score/contribuciones y estado activo (`weight > 0.001`).

`artifacts/api-server/src/lib/calculator.ts:625-655,1056-1084`. La palabra «diversificación» en el switch significa **mezcla con pesos previos**, no un optimizador de diversificación ni Risk Parity. No hay en el constructor una optimización explícita de matriz de covarianza, un objetivo `score · w − λ_riesgo wᵀΣw ...`, ni controles de país/estilo. Los diagnósticos de covarianza se calculan aparte.

**Riesgo de restricción a verificar:** `enforceMaxWeight` limita y distribuye exceso una sola pasada; luego `blendWithPrior` y `normalizeWeights` pueden alterar pesos. No se reaplica el cap final. No se debe afirmar que toda cartera producida cumple `maxEtfWeight` sin una prueba de invariantes sobre casos extremos. Tampoco la suma cash/investido redondeada se reconcilia automáticamente con todos los límites. `artifacts/api-server/src/lib/calculator.ts:639-655,1056-1084`.

El pipeline agrega una watchlist de hasta cinco no seleccionados, resumen de comité y diagnóstico de volatilidad esperada, HHI, número efectivo de apuestas, matriz de correlación, contribuciones de riesgo y tracking error, sujetos a cobertura. Guarda `factorSetVersion` y el conjunto usado en el JSON de la sesión. `artifacts/api-server/src/routes/run.ts:169-215`, `artifacts/api-server/src/lib/calculator.ts:660-685,888-1050`.

### 4.5 Modelos de ponderación y riesgo: evitar confundirlos

**Constructor que decide pesos:** el método de score/ranking anterior (**modelo A**). **Covariance model:** el selector Sample/EWMA/Shrinkage del tab Models llama `GET /api/risk-model` para estimar vol, contribuciones marginales/componentes, diversificación y descomposición sector/cash de la **cartera existente**; no recalcula el portafolio como MinVar. `artifacts/allocation-lab/src/components/portfolio-lab/ModelsTab.tsx:29-80,171-210`; `artifacts/api-server/src/lib/riskModel.ts:250-455`.

**B — Minimum Variance**, **C — Risk Parity**, ensemble/mix y test de acuerdo entre modelos: mostrados como intención futura, sin salida del pipeline. La UI escribe objetivos matemáticos; no constituyen prueba de implementación. «Disparity» no es una selección presente en el backend inspeccionado. Antes de implementarlo se debe acordar la definición matemática exacta. `artifacts/allocation-lab/src/components/portfolio-lab/ModelsTab.tsx:29-80,327-336`.

## 5. Backtest: método completo actual, paso por paso

### 5.1 Contrato, controles y defaults

`GET /api/backtest` acepta `benchmark`, `rebalanceFrequency` (`monthly`/`quarterly`), `executionTiming` (`same_close`/`next_close`/`next_open`), `transactionCostBps`, `slippageBps`, `maxTurnoverPerRebalance`, `cashYieldAnnual`, `warmupDays`, `startDate` y `endDate`. Defaults **del API/motor**: mensual, `next_close`, 10 bps + 5 bps, cap turnover 100%, rendimiento cash 0%, warmup 252 filas, sin fechas. API limita bps 0–500, turnover 0–1, cash 0–20% y warmup 60–756; fechas aceptadas con formato `YYYY-MM-DD` (regex, no validación calendario estricta). Parámetros no reconocidos para frecuencia/timing caen a default. `artifacts/api-server/src/routes/backtest.ts:27-68`, `artifacts/api-server/src/lib/calculator.ts:1271-1281`.

**UI efectiva:** local state inicial con cash yield **4%**, frecuencia mensual, `next_close`, 10/5 bps, benchmark «none» y fechas vacías. El tab expone sliders 0–50 bps de costo, 0–30 de slippage, 0–10% cash, benchmark, frecuencia, timing y fechas. **No muestra controles de turnover cap ni warmup**, aunque el API los acepta. La configuración se pasa al endpoint al activar validación; no constituye una nueva sesión inmutable. `artifacts/allocation-lab/src/pages/portfolio-lab.tsx:33-56`; `artifacts/allocation-lab/src/components/portfolio-lab/BacktestTab.tsx:192-277`.

`endDate` corta el CSV antes de simular, mientras `startDate` impide rebalanceos anteriores pero conserva historia previa para warmup. Usa **universo, restricciones y factor set actuales**, no los de la sesión cuya última asignación disparó la habilitación visual. En datos insuficientes retorna `hasSufficientData: false` con motivo y métricas nulas, no un resultado inventado. `artifacts/api-server/src/routes/backtest.ts:63-132`.

### 5.2 Rebalanceo y cálculo point-in-time

- Primer día de negociación del mes/trimestre después del warmup, no último día del período; la condición `startDate` acota el inicio de rebalanceos. Requiere al menos `warmupDays + 2` filas y una ejecución realizable. `artifacts/api-server/src/lib/calculator.ts:1284-1309,1387-1396,1475-1491`.
- Para cada fecha de señal, `computeSignalAsOf` usa únicamente filas con `date < rebalanceDate`; recalcula régimen, factores activos y asignación. No copia los pesos de la última sesión. Esto es una defensa genuina contra usar **precios posteriores en la generación de señales**. No equivale a que datos, membresía del universo, metadatos y parámetros de factores sean históricamente point-in-time: esos componentes se toman de la configuración actual. `artifacts/api-server/src/lib/calculator.ts:1312-1329,1405-1419`.
- Estado inicial de posiciones simuladas cero; el peso previo configurado influye en el primer target cuando la mezcla de diversificación está activa. Luego los pesos aplicados en cada evento pasan a ser el estado y el prior para la próxima señal. `artifacts/api-server/src/lib/calculator.ts:1406-1415,1471-1472`.

### 5.3 Timing, órdenes simplificadas, costos

- `same_close` asigna fecha de señal como ejecución; `next_close` usa siguiente fila; `next_open` **también** siguiente fila de cierres: no hay precios de apertura, de modo que no simula una apertura real. `artifacts/api-server/src/lib/calculator.ts:1331-1340`; `artifacts/api-server/src/routes/backtest.ts:142-148`.
- Turnover solicitado = `½ Σ |w_target − w_actual|` entre tickers; si excede el cap, **escala uniformemente** la distancia de todos los pesos hacia target. Los pesos se redondean a cuatro decimales; el efectivo es residual. Costo = turnover aplicado × `(transactionCostBps + slippageBps) / 10000` y se resta en la fecha de ejecución. Sin acciones, lotes, horarios, spreads por ticker, profundidad, ADV, impuestos, comisiones por orden o fills parciales. `artifacts/api-server/src/lib/calculator.ts:1420-1468,1507-1508`.
- **Hallazgo crítico de timing que requiere prueba/corrección:** para calcular el retorno entre `prevRow` y `row`, `eventForDate(row.date)` elige **los pesos nuevos cuando `row.date === executionDate`**. Así se asigna a pesos recién ejecutados un retorno de un intervalo que termina en la misma fecha de ejecución (el tramo `prevRow → row`); un fill al cierre no debería haber capturado ese retorno previo al cierre. Afecta también la variante `next_close`, y `next_open` ni siquiera tiene precio open. La señal sí usa datos anteriores, pero la atribución del retorno puede anticipar la ejecución. **No afirmar que el backtest completo está libre de look-ahead por el checklist actual.** `artifacts/api-server/src/lib/calculator.ts:1479-1518`.
- Si falta un precio para un ticker en un día, su contribución se omite en vez de levantar error o registrar explícitamente un gap; si falta precio benchmark, se usa cero al componer el índice. Son políticas implícitas que pueden sesgar la trayectoria. `artifacts/api-server/src/lib/calculator.ts:1501-1516,1563-1566`.

### 5.4 P&L simulado y métricas disponibles

Con el último conjunto de pesos aplicado para la fecha, el rendimiento diario calculado es `cashWeight × cashYieldDiario + Σ pesoETF × (P_t/P_{t-1} − 1) − costoDeRebalanceoSiCorresponde`. Cash diario se obtiene de `(1+cashYieldAnnual)^(1/252)−1`. El equity index arranca en 100 y compone estos retornos; max drawdown usa el máximo histórico del índice. `artifacts/api-server/src/lib/calculator.ts:1493-1521,1553-1573`.

Hay retorno acumulado y anualizado geométrico (252), volatilidad anualizada, ratio «Sharpe», drawdown, turnover medio, suma de costes de eventos, meses compuestos, benchmark buy-and-hold opcional, log de eventos y curva. Solo anualiza con al menos 10 retornos. **La fórmula actual de Sharpe es retorno anualizado / volatilidad anualizada; no resta una tasa libre de riesgo**, aunque un texto de UI sugiera `(CAGR − risk-free)/vol`. La suma `totalTransactionCostPct` es suma simple de cargos por evento, no atribución compuesta al P&L final. Los meses inicial/final pueden ser parciales sin etiqueta especial. `artifacts/api-server/src/lib/calculator.ts:1520-1630`; `artifacts/allocation-lab/src/components/portfolio-lab/BacktestTab.tsx:302-310`.

El benchmark solo está disponible si ticker habilitado y con precios; se presenta como serie sin costos. Una selección de benchmark en UI no cambia el constructor de pesos. `artifacts/api-server/src/lib/calculator.ts:1398-1403,1510-1515,1596-1598`.

### 5.5 «Walk-forward», sensibilidad, auditoría y robustez

- **Folds:** se divide la **curva ya calculada** en tres tramos cronológicos contiguos y se calculan métricas de cada tramo. No hay entrenamiento independiente, optimización de parámetros ni reentrenamiento por fold; `rebalanceCount` queda en 0. El motor sí recalcula señales con precios previos en cada rebalance dentro de la única simulación. Por tanto, el texto de UI `Train[t−L:t] → Trade[t+1:t+h]` sobrestima lo que hacen los folds. `artifacts/api-server/src/lib/calculator.ts:1633-1687`, `artifacts/allocation-lab/src/components/portfolio-lab/BacktestTab.tsx:435-440`.
- **Sensibilidad implementada:** grilla de 12 combinaciones (2 frecuencias × 2 timings × 3 costos; si hay costos duplicados podrían repetirse valores), con `same_close`/`next_close`, costos 0/base/base+25, y un aviso por rango de Sharpe >0.75 o retorno que cambia de signo. No prueba pesos factoriales ±10/20%, modelos de covarianza como constructores, bootstrap, cash, slippage, cap, fechas o selección automática de señales. `artifacts/api-server/src/lib/calculator.ts:1690-1732`.
- **Bias/integrity audit:** checklist ponderado de disciplina de señal, historia suficiente, survivorship, timing, robustez y otros supuestos; da `research_grade` desde score 85, `developmental` desde 60, `not_reliable` por debajo, con hard fail si algún check falla. La nota de supervivencia del universo actual se mantiene. Es una **calificación interna heurística** y no una auditoría causal del timeline de ejecución ni certificación externa. `artifacts/api-server/src/lib/calculator.ts:1734-1838`; `artifacts/api-server/src/routes/backtest.ts:142-150`.
- **Robustness A–G en UI:** Parameter Perturbation, Bootstrap, Covariance Sensitivity, Model Disagreement, Rolling Out-of-Sample, Constraint Sensitivity y Turnover Sensitivity. En la tabla de UI A/B/C/F/G están marcados como pendientes de validación, D requiere múltiples modelos y E es parcial (score calculado a partir de los Sharpes de los folds). La fórmula de «robustness composite» es expositiva, no un score integral ejecutado por la API. `artifacts/allocation-lab/src/components/portfolio-lab/BacktestTab.tsx:78-95,115-125,138-185,501-610`.
- **Stress/scenario** está embebido en Backtest pero es otro cálculo, no una estrategia adicional: escenarios con shocks y replay de ventanas históricas predefinidas, cuya cobertura depende del CSV disponible. `artifacts/allocation-lab/src/components/portfolio-lab/BacktestTab.tsx:606-610`, `artifacts/api-server/src/routes/scenarioStress.ts:41-156`, `artifacts/api-server/src/lib/scenarioStress.ts:115-122`.

### 5.6 Lo que el backtest *no* registra aún

No devuelve un ledger por día con peso al inicio, retorno por activo, efectivo, costo por activo/orden, contribución bruta/neta que cierre con el índice, factor set elegido **en esa fecha** y exposiciones históricas por segmento. `rebalanceLog` conserva solo resumen (fechas, lookback, régimen, cash, número activo, top 3, turnovers/costo). No hay snapshot inmutable de configuración + hash/identidad del dataset por ejecución; repetir el GET tras un cambio de datos/configuración puede producir otra respuesta. `artifacts/api-server/src/lib/calculator.ts:1444-1468,1529-1550`; `artifacts/api-server/src/routes/backtest.ts:63-68,102-132`.

## 6. Atribución y riesgo que existen fuera del backtest

### 6.1 Atribución realizada por versión

`GET /api/attribution/meta` informa preparación y `GET /api/attribution` analiza una sesión guardada con precios posteriores a su fecha: contribución ETF `peso × retorno realizado` para un **período**, active contribution basada en delta vs peso previo, contribución/drag de cash, evaluación descriptiva de decisiones NEW/INCREASED/HELD/REDUCED/REMOVED, costo supuesto y comparación benchmark. Puede exigir historia posterior; una sesión reciente no necesariamente está lista. **No es el ledger multi-rebalance del backtest**; usa los pesos congelados de una sesión y el CSV de precios disponible ahora. `artifacts/api-server/src/routes/attribution.ts:43-111,111-255`, `artifacts/api-server/src/lib/attribution.ts:157-283,335-420`.

La atribución factorial actual toma cinco buckets **legacy** (Momentum, Trend Quality, Realized Volatility, Mean Reversion, Drawdown/Risk Fit), calcula score ponderado y **correlación cross-sectional** entre scores y retornos ETF si al menos tres activos tienen retorno. No asigna cantidades de P&L a factores; no usa necesariamente cada factor dinámico del set activo como unidad de atribución, ni separa efectos de selección y sizing. No interpretar `correlationWithReturn` como contribución monetaria, causalidad o prueba robusta fuera de muestra. `artifacts/api-server/src/lib/attribution.ts:149-155,286-333`.

### 6.2 Riesgo y segmentos

El diagnóstico de la corrida incluye volatilidad, HHI, número efectivo de apuestas, correlación, contribuciones por ETF y tracking error cuando hay datos. `GET /api/risk-model` añade covarianza sample/EWMA/shrinkage, vol/downside, riesgo marginal/componente, descomposición **sector + cash**, beta y warnings de historia insuficiente. Esto es riesgo calculado para **la asignación consultada**, no contribuciones históricas diarias del backtest ni un constructor MinVar. `artifacts/api-server/src/lib/calculator.ts:888-1050`, `artifacts/api-server/src/lib/riskModel.ts:250-455`.

País y estilo no están en el esquema de universo observado como atributos históricos auditados; «Global - Japan» en `sector` es una etiqueta, no una taxonomía país separada. Un ETF puede tener exposición a varios países/estilos, cambiante en el tiempo: atribuirlo entero a un país a partir del nombre sería un proxy, no medición. Para riesgo por **factor** y P&L por **señal**, hay que definir si se reporta exposición ex ante, contribución de modelo, atribución de retorno estadística o impacto contrafactual. Estas cantidades no son equivalentes.

## 7. API relevante y acoplamientos

| Método y ruta | Uso real | Persistencia / advertencia |
|---|---|---|
| `GET /api/prices/status`; `POST /api/prices/upload`; `POST /api/prices/live` | Lectura de cobertura, carga CSV, descarga Yahoo. | POST agrega dataset; no usar como prueba read-only. |
| `GET/PUT /api/universe`, `/api/constraints`, `/api/factors/library`; `POST /api/factors/library/restore/:version` | Parámetros persistidos de la estrategia vigente. | Actualizar factores/constraints puede cambiar el próximo backtest GET. |
| `POST /api/run`; `GET /api/results/latest`; `GET /api/sessions`, `/api/sessions/:sessionId` | Nueva corrida, última salida, historia y detalle de sesiones. | `POST /run` escribe `sessions.result_json`. |
| `GET /api/backtest` | Simulación de **estado actual**; parámetros de consulta. | Computa al leer; no fija una versión históricamente reproducible. |
| `GET /api/risk-model`; `GET /api/attribution/meta`; `GET /api/attribution` | Riesgo actual y atribución posterior a sesión. | Distintos universos temporales/metodologías: no sumar entre sí. |
| `GET /api/scenario-stress/meta`; `POST /api/scenario-stress/run`; `GET /api/trade-implementation/meta`; `GET /api/trade-implementation` | Cobertura de escenarios, shocks/replay, operación propuesta. | Stress se solicita con POST y no es un histórico de señales. CSV solo trae close, no ADV fiable. |
| `GET /api/archive`, `/api/archive/:sessionId`, `/api/archive/compare`; rutas `/api/governance/*` y `/api/reports/*` | Versiones, comparación, snapshots/locks, informes. | Gobernanza/reportes no sustituyen una identidad de dataset inmutable. |
| `GET /api/signals/catalog`, `/api/signals/latest`, `/api/signals/history` | Exportación **read-only** de sesiones y último CSV a un consumidor servidor-a-servidor. | No hay publicación automática al Signal Hub, ni integración Data Engine; requiere `SIGNAL_EXPORT_TOKEN`. En la lectura de desarrollo retornaron `503 integration_not_configured`. No existe endpoint `/signals/as-of`; los filtros `dateFrom/dateTo` no reconstruyen un run histórico. |

Fuentes: `artifacts/api-server/src/routes/index.ts:1-44`, `artifacts/api-server/src/routes/signals.ts:24-49,118-195`, `artifacts/api-server/src/lib/signal-export.ts:304-385`, `artifacts/api-server/SIGNAL_EXPORT.md`.

## 8. Limitaciones y discrepancias priorizadas

### Alta prioridad para corregir antes de ampliar o confiar en backtests

1. **Timeline de ejecución y retorno:** pesos del cierre de ejecución atribuidos al retorno `prev → execution`, con potencial sesgo de ejecución/look-ahead aunque la señal no use precios futuros. Diseñar tests de dos o tres días con un salto de precio en el día del fill. `calculator.ts:1479-1518` (ruta completa arriba).
2. **Reproducibilidad:** backtest lee CSV, factores y restricciones actuales; el run guarda salida pero no identidad/hash inmutable del dataset ni una configuración versionada completa para replay; snapshots de gobernanza no resuelven solos esta unión. `routes/backtest.ts:63-68,102-132`, `routes/run.ts:181-215`.
3. **Precios ausentes/gaps y restricciones de pesos:** política implícita de ignorar retornos sin precio; cap de peso antes de mezcla/normalización; faltan pruebas automáticas de reconciliación e invariantes. `calculator.ts:639-655,1056-1084,1501-1516`.
4. **Texto de UI vs método real:** modelo A no resuelve el objetivo mostrado; B/C no calculan, folds no entrenan, Sharpe no descuenta risk-free, «Research Grade» es puntuación interna. Corregir etiquetas para no inducir conclusiones no sustentadas. `ModelsTab.tsx:29-80`, `BacktestTab.tsx:194-197,302-310,435-440`, `calculator.ts:1576-1594,1633-1687`.

### Limitaciones estructurales conocidas

- Universo vigente aplicado al pasado: sesgo de supervivencia; no reconstrucción de ETF delistados/fusionados, membresía sectorial/país/estilo ni costos/liquidez históricos. Uso de adjusted close; `next_open` aproximado con close; no open real, bid/ask, volumen, FX, EPS, series fundamentales. `artifacts/api-server/src/routes/backtest.ts:142-150`.
- No hay tests de regresión automatizados (`*.test.*`, `*.spec.*` o script `test`) encontrados al revisar el workspace. OpenAPI/Zod valida contratos y hay lecturas manuales, **pero eso no valida aritmética financiera, ausencia de leakage, extremos, datos faltantes o equivalencia live/backtest**. `package.json`, `artifacts/api-server/package.json`.
- La selección de factores es **manual** y la renormalización por disponibilidad no es una política de selección estadística. `factor_library` puede almacenar campos cuyo efecto computacional aún no está implementado; nuevas señales requieren integración de series, cronología y validación por cobertura. `factor-library.ts:12-37,101-113`; `calculator.ts:322-458`.

## 9. Propuesta técnica para discusión (no trabajo aprobado)

### Etapa A — hacer confiable la base existente

1. Definir formalmente las convenciones: fecha de señal, último dato observable, precio de ejecución, período de tenencia, instante en que un peso entra en vigor, tratamiento de ETF sin cotización, cash y comparación con benchmark. Corregir el timeline detectado **antes** de usar métricas para seleccionar modelos/factores.
2. Construir un ledger point-in-time por ejecución y por día: dataset/snapshot, universo, parámetros, factores y coberturas, target, pesos efectivamente aplicados, precio y timestamp, posiciones, retorno por ticker, efectivo y costos; IDs y hashes de insumos. Garantizar por pruebas `retorno_neto_diario = Σ contribuciones ETF + contribución cash − costos ± residuo explícito` y reconciliación acumulada con la curva.
3. Formalizar validación de CSV/corporate actions, series faltantes y calendario, aplicar las restricciones **después de todas las transformaciones** y probar extremos (pesos máximos, cash, cero activos, gaps, benchmark ausente). Guardar resultados de backtest/versiones reproducibles.

### Etapa B — modelos y mezcla de ponderaciones verdaderos

4. Mantener Model A como baseline, corregir su descripción; implementar **Minimum Variance** y **Risk Parity** sobre la misma ventana observable y constraints, con covarianza regularizada, diagnósticos de factibilidad y fallos explícitos. Si «disparity» es otro modelo, precisar objetivo, restricciones y método antes de incluirlo.
5. Elegir un solo constructor o una mezcla convexa de **carteras realmente calculadas**, pesos de mezcla configurables y versionados; tras mezclar, re-proyectar constraints y explicar desvíos del mix deseado. Comparar modelos sobre idénticas fechas, datos, costos y benchmark; no mezclar métricas generadas con supuestos diferentes.

### Etapa C — selección de factores/señales defendible

6. Conservar modo manual como fuente de verdad operativa. Agregar como **modo opt-in** una política reproducible de propuesta de factores: cobertura mínima point-in-time, redundancia/correlación, estabilidad, turnover y aporte incremental fuera de muestra, con reglas de desempate. Explicar por qué entra/sale cada factor y registrar el set **en cada rebalance**; no elegir retrospectivamente el mejor factor usando todo el período de prueba.
7. Separar claramente factores implementados sobre precios, fórmulas descriptivas, factores no soportados y señales externas. Incorporar un factor externo solo con serie histórica, disponibilidad y fecha efectiva, lag de publicación, unidad, versión, calidad, derechos de uso e identidad del proveedor. No prometer ingestión Signal Hub/Data Engine que hoy no existe.

### Etapa D — atribución rigurosa de P&L y riesgo

8. **Contabilidad del backtest:** P&L bruto/neto y retorno por ticker y período, cash, costos y slippage, aportes vs benchmark y contribución activa; mensual, por rebalance y acumulada, con conciliación al ledger. Descomponer decisiones de selección vs sizing vs timing bajo una metodología declarada, sin llamar «causal» al resultado por defecto.
9. **Riesgo:** descomposición de varianza/marginal/componente por activo y segmentación; estimaciones ex ante en el rebalance y resultados ex post, incluyendo correlación entre segmentos. Definir cómo asignar covarianzas cruzadas para no sumar contribuciones dos veces.
10. **Factor/señal:** ofrecer al menos tres vistas etiquetadas por método: exposiciones de la cartera; correlaciones/regresión o atribución estadística con intervalos y diagnóstico de colinealidad; impacto contrafactual de retirar un factor y volver a ejecutar toda la política fuera de muestra. El contrafactual no es una partida contable de P&L y la suma de impactos individuales puede no igualar el retorno total.
11. **Segmentos, países y estilos:** comenzar con `sector` disponible, reconociendo etiquetas ambiguas; para país/estilo exigir clasificaciones con fecha efectiva o holdings look-through con cobertura trazable. Mostrar «no disponible» y porcentaje no clasificado cuando falten datos; no inferir geografía automáticamente de un nombre de ETF.
12. Tests automatizados con series sintéticas **solo en tests**, datos congelados de referencia, tests de no-look-ahead, reconciliación, escenarios de cambio de régimen, cobertura ausente y sensibilidad. Distinguir en UI métricas descriptivas, inferencias estadísticas y resultados operativos validados.

### Decisiones que conviene acordar entre agentes antes de construir

- ¿«Disparity» significa **Risk Parity**, **Maximum Diversification** u otro método?
- ¿La selección de factores será solo recomendación al usuario o decisión automática por rebalance? ¿Qué universo de factores puede considerar y cuál es la función objetivo fuera de muestra?
- ¿Se quiere atribución del **backtest simulado**, de la **cartera real posterior a cada sesión**, o ambas con paneles diferenciados?
- ¿Cuál es el benchmark, moneda, calendario y definición de retorno neto/risk-free? ¿Cómo tratar ETF con precios faltantes, entradas/salidas del universo y ajustes corporativos?
- ¿Existe un proveedor confiable de clasificación histórica país/estilo y series de señales externas? Si no, el alcance honesto inicial es ticker/sector y factores calculados internamente.

## 10. Guía rápida de lectura para el agente revisor

1. Empezar por `artifacts/api-server/src/routes/run.ts:74-260` y `artifacts/api-server/src/routes/backtest.ts:47-176` para comparar la corrida guardada con el GET del backtest.
2. Seguir `artifacts/api-server/src/lib/calculator.ts:322-655,1056-1084,1154-1838` para factores, régimen, constructor, eventos, retornos e integridad. Revisar especialmente `:1479-1518` con tests de timeline.
3. Ver `artifacts/api-server/src/lib/factor-library.ts:12-188`, `artifacts/api-server/src/lib/attribution.ts:149-333`, `artifacts/api-server/src/lib/riskModel.ts:250-455`.
4. Contrastar la implementación con `artifacts/allocation-lab/src/pages/portfolio-lab.tsx`, `artifacts/allocation-lab/src/components/portfolio-lab/{FactorsRegimesTab,ModelsTab,BacktestTab,AllocationTab}.tsx` y `artifacts/allocation-lab/src/components/settings/sections/ModelFactorsSection.tsx`.
5. Revisar contratos en `lib/api-spec/openapi.yaml`, rutas registradas en `artifacts/api-server/src/routes/index.ts` y esquemas en `lib/db/src/schema/`. **No ejecutar POST/PUT en una revisión read-only.**

**Conclusión:** hay una base funcional de señales internas configurables, asignación determinista y backtest histórico con señales anteriores al rebalance, pero no selección automática validada de factores, múltiples constructores operativos ni atribución reconciliable por factor/señal/país/estilo. Antes de ampliar el análisis, el timeline de ejecución, el manejo de datos faltantes y la identidad reproducible de cada dataset/configuración merecen una revisión técnica prioritaria.