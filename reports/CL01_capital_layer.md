# CL-01 — validación acotada de cash versus riesgo

Fecha: 2026-10-13. Resultado inicial: **FAIL; CL-01 no quedó certificado**.

Resultado posterior a la corrección autorizada: **PASS de la mecánica probada: 48/48 casos individuales, sin omitidos**. La evidencia inicial se conserva debajo; la corrección y sus resultados se agregan en la sección final. Este PASS no acredita rentabilidad ni robustez económica.

## Identidad y límites

- Ruta: `/workspace/Allocationlab`.
- Remoto: `https://github.com/juanser15/Allocationlab.git` (`juanser15/Allocationlab`).
- Rama conservada: `work`.
- Commit conservado: `1163a0b574b573004372a3a2fc8752810dea7ef9`.
- Estado inicial: limpio, sin cambios pendientes.
- Archivos nuevos: este reporte y `artifacts/api-server/src/lib/calculator.cl01.test.ts`.
- Sin cambios de producción, tests existentes, manifests o lockfiles. Sin checkout, reset, commit, instalación de dependencias, conexión a producción, deploy ni backtests históricos.
- Se reutilizó el entorno adjunto y sus dependencias. No se repitió el onboarding. La localización inicial listó metadatos de directorios de `/workspace`, incluido `DT`; no se leyeron fuentes ni se ejecutó trabajo en otros repositorios. Todas las inspecciones de código y pruebas fueron en Allocationlab.
- No hay `AGENTS.md` en la ruta ni dentro del repositorio. Se leyeron `replit.md`, `.agents/memory/MEMORY.md` y las notas locales sobre límites as-of y runner ESM. El documento de estado en `docs/` es evidencia previa, no certificación del código actual.

## Implementación localizada

Las referencias siguientes corresponden al commit indicado, sin cambios de producción.

| Función / ubicación | Comportamiento observado |
|---|---|
| `constructAllocation`, `calculator.ts:714` | Decide cash dentro de `[cashMin, cashMax]` según `regime.composite`. Define `investedBudget = 1 - cashTarget`; sus pesos ya representan fracciones del patrimonio total. |
| `normalizeWeights`, `calculator.ts:1173` | Normaliza a **investedBudget**, preservando cash; no lleva automáticamente la parte invertida a 100% del patrimonio. |
| `validateFinalAllocation`, `calculator.ts:1226` | Verifica presupuesto y cantidad activa. La exigencia de ETFs activos impide el extremo de presupuesto invertido cero. |
| `computeSignalAsOf`, `calculator.ts:1526` | Para señales de cierre, calcula con filas estrictamente anteriores a la fecha de señal. |
| `generateRebalanceDates` / `resolveExecutionDate`, `calculator.ts:1502,1542` | Agenda mensual o trimestral; cierre de señal, siguiente cierre o siguiente apertura. |
| `runBacktestEngine`, `calculator.ts:1857` | Marca las posiciones existentes, acredita intereses del cash inicial del intervalo y ejecuta targets en el cierre correspondiente. Aplica pesos una vez: `quantity = afterCostNav * weight / price`; conserva cash como residuo. Mantiene cantidades entre fills. |
| `runNextOpenBacktestEngine`, `calculator.ts:1555` | Señal con información hasta el cierre t, fill en apertura t+1; separa gap de posiciones antiguas y retorno apertura/cierre de posiciones nuevas. |
| `run.ts:177` | La ruta de asignación obtiene cash como `1 - suma(pesos)`. Es una lectura de código, sin ejecución de API. |

Regla de cash existente, probada con entradas sintéticas de régimen y composición fija:

```text
cashTarget = clamp(cashMin + (cashMax - cashMin)/2
                   + (50 - composite)/50 * (cashMax - cashMin)/2,
                   cashMin, cashMax)
```

Con banda 20–80%, composites 0/25/50/75/100 producen cash 80/65/50/35/20%. El test mantiene scores sintéticos 75/25 y verifica que la composición relativa invertida siga siendo 75/25. La integración constructor→motor usa dos activos con iguales precios/scores y parte invertida 50/50; cada uno termina con valor 25 y cash 50 sobre NAV 100.

No se identificó una política independiente de capital que acepte una composición fija y decida únicamente su escala en la ruta inspeccionada. La decisión de cash está dentro del constructor; el callback `targetWeightsForSignal` permite suministrar targets explícitos al motor. No se inventó una implementación separada ni se evaluaron selección de ETFs, optimizadores, factores o alpha streams. En los tests temporales se usa un único activo para mantener fija la composición invertida.

## Cobertura y resultado por criterio

Archivo nuevo: `artifacts/api-server/src/lib/calculator.cl01.test.ts`. Importa A1 para reutilizar **sus nueve tests intactos**. Todos los casos nuevos llevan `CL01 SYNTHETIC` en el nombre. No se simulan `constructAllocation`, `computeSignalAsOf` ni el backtester. El shim DB existente evita abrir una conexión; los callbacks nuevos son entradas admitidas por la API real del motor.

| Criterio | Estado | Evidencia |
|---|---|---|
| Exposición aplicada una sola vez; normalización conserva cash | **PASS** | Test `cash decision respects the band and preserves fixed invested composition`; integración con 25/25 en activos y 50 cash. Además, tres tests 50/50 comprueban notional 50, no 25 ni 100. |
| 50% activo + 50% cash, activo +2%, cash/costos cero → +1% | **PASS** | `50% asset + 50% cash earns +1% on asset +2%`, en `same_close`, `next_close`, `next_open`: cantidad `50/120`, P&L 1, retorno del intervalo 0.01 y NAV final 101. Los saltos anteriores a la compra no generan P&L de posiciones nuevas. |
| Extremos 100% cash y 100% activo | **FAIL** | `100% asset earns full +2%`: 3 PASS, NAV 102. `explicit 100% cash target earns only cash interest`: 3 PASS, sin posiciones/trades/costos y cash compuesto. `constructor supports a 100% cash decision`: 3 FAIL por `AllocationConstraintError`; falta soporte en la decisión integrada. |
| Conciliación de posiciones, intereses, costos y patrimonio | **PASS** | `mixed book reconciles positions, cash interest, costs and equity`: 3 PASS. Verifica P&L desde cantidades/precios, movimiento de cash por notionals reales, cantidades por trades, interés sobre cash inicial, fees/slippage una vez, NAV continuo y curva. A1 TEST 6 también pasa. |
| Ausencia de datos futuros; ejecución según corte de información | **FAIL** | `built-in cash decision and execution respect the information cutoff`: 3 PASS; A1 TEST 1/5 y next_open también PASS. Pero `explicit cash/risk target cannot consume future rows`: 2 FAIL en cierre; una modificación futura altera fills y cash anteriores. |
| Objetivo actualizado en cada rebalanceo; sin operaciones implícitas entre rebalanceos | **PASS** | `cash objective refreshes only at monthly rebalances`: 3 PASS. Señales 2026-01-22, 2026-02-01, 2026-03-01; cash objetivo efectivamente cambia, coincide con el corte y se aplica en la fecha de ejecución. Fuera de fills, cantidades constantes, trades y costos cero. A1 TEST 4 también pasa. |

Los PASS certifican únicamente los casos sintéticos indicados. La agenda trimestral y los límites de turnover vinculantes quedan **NO VERIFICADOS** en esta comprobación; los casos CL-01 usan agenda mensual y cap no vinculante. No se afirma equivalencia con una política separada aún no implementada.

### Convenciones contables verificadas

- `cashPnl = beginningCash * ((1 + cashYieldAnnual)^(1/252) - 1)`.
- Cierre: posiciones antiguas ganan el intervalo previo→cierre; posiciones compradas al cierre empiezan a ganar después.
- Apertura: cantidades antiguas ganan previo→apertura; cantidades posteriores al fill ganan apertura→cierre.
- `endingCash = beginningCash + cashPnl - suma(trade.notional) - fees - slippage`.
- `endingNav = beginningNav + etfPnl + cashPnl - fees - slippage = endingCash + valor(posiciones)`.
- La ruta de cierre cobra sobre NAV pretrade × mitad de L1 de cambios en pesos **ETF, sin cash**. La de apertura cobra sobre notional absoluto real autofinanciado. Son convenciones diferentes existentes; los tests comprueban cada una, no certifican su equivalencia ni redefinen el costo. Con costos cero ambas cumplen el caso +1%.

## Fallos reproducidos y corrección mínima propuesta — no aplicada

### 1. El constructor rechaza 100% cash

Con un activo elegible, mínimo ETF cero, `cashMin = cashMax = 1` y `targetActiveEtfs = 1`, el presupuesto invertido es cero. Todos los pesos quedan en cero y `validateFinalAllocation` exige una cantidad positiva de activos. El motor integrado lanza:

```text
AllocationConstraintError: Constraint set infeasible: final portfolio weights failed
the configured minimum, maximum, active-count, or invested-budget check.
```

Los tres tests conservan la expectativa de NAV 100 sin posiciones con yield cero; no se transformaron en `assert.throws`. El motor contable sí maneja un target explícito `{}` y paga interés solo sobre cash.

Propuesta mínima: tratar explícitamente presupuesto invertido cero en `constructAllocation`, devolver pesos cero y permitir cantidad activa cero solo en ese caso. Mantener validaciones para presupuestos positivos y conflictos con mínimos ETF positivos. Esto requiere definir esa excepción de mandato; no se modificó código ni se inventó otra política de capital.

### 2. Targets explícitos de cierre pueden consumir datos futuros

En `calculator.ts:2005,2010`, ambas variantes del callback de cierre reciben `priceRows` completa. El contexto opcional declara el cierre previo, pero no recorta esas filas. La ruta next_open sí entrega `informationRows` hasta t (`calculator.ts:1795`).

El caso sintético cambia **solo** el precio AAA de 2026-01-08, de 104 a 1000. Una política de entrada sensible a la última fila recibida pasa de 75% a 25% activo. Cambia el fill de 2026-01-04 (`same_close`) o 2026-01-05 (`next_close`): cantidad 0.75→0.25 y cash 25→75, aunque la modificación es posterior. Los tests fallan con `future mutation must not alter earlier cash, fills or P&L`.

Propuesta mínima: calcular una única lista `informationRows = priceRows.filter(r => r.date < signalDate)` en la ruta de cierre y pasarla al callback tanto con contexto como sin él, conservando el corte del cierre previo. Mantener next_open con `<= signalDate` y los precios reales de fill. No aplicar un filtro dentro del test para ocultar el defecto.

## Comandos y evidencia de ejecución

Todos los comandos del repositorio se ejecutaron bajo `/workspace/Allocationlab`, excepto el bundling nuevo, cuyo cwd es `/workspace/Allocationlab/artifacts/api-server`.

1. Identidad/instrucciones: `pwd`, `git rev-parse --show-toplevel`, `git remote -v`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, `rg --files --hidden -g AGENTS.md -g '!node_modules' -g '!.git'`; lecturas `cat`, `sed`, `rg` y `nl` de instrucciones, manifests, A1, calculator y referencias de rutas. `/workspace` no es raíz Git; se resolvió la ruta local existente sin clonar ni cambiar versión.
2. Comando solicitado:

   ```sh
   pnpm --filter @workspace/api-server run test:a1
   ```

   No ejecutó tests: pnpm intentó verificar/reinstalar dependencias y falló creando `/home/agent/.local/share/pnpm` (`ENOENT`, proceso externo 254). No se continuó con instalación.
3. Con dependencias existentes y configuración temporal del runner:

   ```sh
   pnpm --config.verify-deps-before-run=false --filter @workspace/api-server run test:a1
   node --test --test-reporter=tap artifacts/api-server/dist/calculator.a1.test.mjs
   node artifacts/api-server/dist/calculator.a1.test.mjs
   ```

   El script y `node --test` salieron 0 y mostraron una entrada de archivo. La ejecución directa del mismo bundle emitió las nueve aserciones A1: **9 PASS, 0 FAIL**, exit 0. La configuración temporal no altera manifests/lockfiles.
4. Runner CL-01 sin nuevo manifest; se ejecutó tras la primera cobertura y después de agregar los tres casos de corte incorporado:

   ```sh
   # cwd: /workspace/Allocationlab/artifacts/api-server
   ./node_modules/.bin/esbuild src/lib/calculator.cl01.test.ts --bundle --platform=node --format=esm --packages=external --alias:@workspace/db=./src/lib/calculator.a1.db-shim.ts --outfile=dist/calculator.cl01.test.mjs
   # cwd: /workspace/Allocationlab
   node artifacts/api-server/dist/calculator.cl01.test.mjs > /tmp/allocationlab-cl01-results.txt 2>&1
   ```

   Bundling final: exit 0. Tests finales: **33 ejecutados, 28 PASS, 5 FAIL, 0 omitidos**, exit 1. Incluye A1 **9/9 PASS** y cobertura nueva **19 PASS / 5 FAIL** (24 nuevos). Primera ejecución intermedia: 30 tests, 25 PASS / 5 FAIL; no cambió ninguno de los tests que reprodujeron fallos.
5. Verificación de límites: `git diff --check`, `git diff --exit-code HEAD -- artifacts/api-server/src/lib/calculator.ts artifacts/api-server/src/lib/calculator.a1.test.ts artifacts/api-server/src/lib/calculator.a1.db-shim.ts package.json artifacts/api-server/package.json pnpm-workspace.yaml pnpm-lock.yaml`, estado final y diff global de archivos ya tracked. Producción/A1/manifests/lockfiles idénticos a HEAD; solo los dos archivos nuevos pendientes. Los bundles son salidas ignoradas del runner.

Salida detallada transitoria: `/tmp/allocationlab-cl01-results.txt`; los casos y comandos reproducibles están en el test nuevo y este reporte. Comprobación CL-01 concluida; correcciones propuestas pendientes, sin ampliar el alcance.

## Corrección acotada autorizada — evidencia posterior

Se retomó la misma rama `work` y commit `1163a0b574b573004372a3a2fc8752810dea7ef9`. Los dos archivos anteriores estaban pendientes; se conservaron. No se repitió onboarding ni auditoría. Las secciones anteriores describen el estado **inicial**, incluido su FAIL; esta sección registra el estado posterior.

### Causa y diff mínimo

**Datos futuros:** el callback de cierre recibía la serie completa, aunque el cálculo incorporado y el contexto ya usaban el corte del cierre previo. En `runBacktestEngine` ahora se calcula `informationRows` con `< row.date`, se reutiliza para régimen/lookback y se pasa al callback tanto sin contexto como con `provideTargetContext` o `d5GrossTradeCosts`.

```diff
+ const informationRows = priceRows.filter((item) => item.date < row.date);
- regime: computeRegime(priceRows.filter((item) => item.date < row.date), enabledTickers)
+ regime: computeRegime(informationRows, enabledTickers)
- lookbackDays: priceRows.filter((item) => item.date < row.date).length
+ lookbackDays: informationRows.length
- targetWeightsForSignal(row.date, priceRows, Object.freeze({ ... }))
+ targetWeightsForSignal(row.date, informationRows, Object.freeze({ ... }))
- targetWeightsForSignal(row.date, priceRows)
+ targetWeightsForSignal(row.date, informationRows)
```

Ubicación actual: `calculator.ts:2000,2010,2015`. La serie completa sigue disponible para marcar posiciones y ejecutar los fills; no se filtró dentro de políticas/tests. La función next_open no fue editada: conserva información `<= t`, contexto al cierre t y fill en apertura t+1. Las regresiones distinguen precios de corte, cierre de señal, siguiente cierre y siguiente apertura.

**Presupuesto cero:** la validación de cantidad activa exigía invertir aun cuando el mandato asignaba todo a cash. En `constructAllocation` se agregó el caso **exacto** `investedBudget === 0`, rechazo explícito de mínimo ETF positivo, selección vacía para ese caso y cantidad requerida cero al validar. Se reutiliza el formato de salida existente; no se modifica `validateFinalAllocation` ni los helpers de pesos.

```diff
+ const cashOnly = investedBudget === 0;
+ if (cashOnly && minEtfWeight > 0) {
+   throw new AllocationConstraintError("Constraint set infeasible: a 100% cash allocation cannot satisfy a positive minimum ETF weight.");
+ }
- const eligible = factorData.filter(...);
+ const eligible = cashOnly ? [] : factorData.filter(...);
- if (eligible.length < targetActiveEtfs) {
+ if (!cashOnly && eligible.length < targetActiveEtfs) {
- validateFinalAllocation(..., investedBudget, targetActiveEtfs);
+ validateFinalAllocation(..., investedBudget, cashOnly ? 0 : targetActiveEtfs);
```

Ubicación actual: `calculator.ts:727,732,734,757`. No se usa tolerancia para decidir cash-only. Se rechaza incluso mínimo ETF `1e-12` cuando el presupuesto es cero. Con presupuesto positivo, incluidos valores cercanos a `1e-12`, siguen operando selección, cantidad activa y restricciones de inversión. Las validaciones generales anteriores siguen ejecutándose antes de la excepción.

Diff de producción completo: **12 inserciones / 7 eliminaciones, solo estas dos funciones de `calculator.ts`**. Sin refactor de arquitectura ni cambio de costos, factores, optimizadores, alpha streams o quality gate.

### Runner, códigos de salida y preservación

Se agregó únicamente `artifacts/api-server/src/lib/calculator.cl01-regressions.test.ts`. Importa CL-01, que a su vez importa A1; así ejecuta los 33 casos originales y 15 adicionales en un mismo proceso, con resultados individuales.

```sh
# cwd: /workspace/Allocationlab/artifacts/api-server
./node_modules/.bin/esbuild src/lib/calculator.cl01-regressions.test.ts --bundle --platform=node --format=esm --packages=external --alias:@workspace/db=./src/lib/calculator.a1.db-shim.ts --outfile=dist/calculator.cl01-regressions.test.mjs
# cwd: /workspace/Allocationlab
node artifacts/api-server/dist/calculator.cl01-regressions.test.mjs > /tmp/allocationlab-cl01-after-results.txt 2>&1
```

- Bundling: **exit 0**.
- Ejecución: **exit 0**, 48 casos, **48 PASS / 0 FAIL / 0 omitidos / 0 cancelados / 0 todo**.
- Originales: **33/33 PASS** (incluye A1 9/9). Nuevos: **15/15 PASS**.
- No se modificaron expectativas, tolerancias ni omisiones de los originales.
- Antes de editar se guardaron hashes con `sha256sum ... > /tmp/allocationlab-cl01-original.sha256`; después, `sha256sum -c /tmp/allocationlab-cl01-original.sha256` dio **exit 0** y `OK` para A1, CL-01 original, ambos package.json, pnpm-workspace.yaml y pnpm-lock.yaml.
- `git diff --check`: **exit 0**, sin errores. `git diff --no-index --check /dev/null artifacts/api-server/src/lib/calculator.cl01-regressions.test.ts` y la comprobación equivalente de este reporte: **exit 1**, salida vacía, por diferencias frente a `/dev/null` en archivos nuevos; sin diagnósticos de whitespace.
- `git diff --stat`, `git diff -- artifacts/api-server/src/lib/calculator.ts`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD` y lecturas `nl` verificaron diff, alcance e identidad.
- Se reutilizaron dependencias instaladas y el shim DB existente; no hizo falta reinstalación ni configuración persistente de pnpm. Los bundles siguen siendo archivos ignorados.

### Resultado individual de los 33 casos originales

Cada fila identifica el nombre completo del caso ejecutado, con resultado posterior **PASS**.

| # | Caso | Resultado |
|---|---|---|
| 1 | TEST 1 — price jump before purchase | PASS |
| 2 | TEST 2 — constant prices without costs leave NAV constant | PASS |
| 3 | TEST 3 — constant prices with purchases/sales charge only explicit costs | PASS |
| 4 | TEST 4 — held quantities stay fixed and weights drift without trades | PASS |
| 5 | TEST 5 — future price mutation cannot alter earlier signals, fills or P&L | PASS |
| 6 | TEST 6 — every daily ledger entry and the compounded curve reconcile | PASS |
| 7 | A1 next_open signals at close t, fills at t+1 open, and only new shares earn open-to-close | PASS |
| 8 | A1 next_open is point-in-time and fails for missing held or traded adjusted opens | PASS |
| 9 | A1 signed execution accounts for short proceeds, covers, P&L and one-time costs | PASS |
| 10 | CL01 SYNTHETIC — cash decision respects the band and preserves fixed invested composition | PASS |
| 11 | CL01 SYNTHETIC — 50% asset + 50% cash earns +1% on asset +2% (same_close) | PASS |
| 12 | CL01 SYNTHETIC — 100% asset earns full +2% (same_close) | PASS |
| 13 | CL01 SYNTHETIC — explicit 100% cash target earns only cash interest (same_close) | PASS |
| 14 | CL01 SYNTHETIC — constructor supports a 100% cash decision (same_close) | PASS |
| 15 | CL01 SYNTHETIC — mixed book reconciles positions, cash interest, costs and equity (same_close) | PASS |
| 16 | CL01 SYNTHETIC — cash objective refreshes only at monthly rebalances (same_close) | PASS |
| 17 | CL01 SYNTHETIC — built-in cash decision and execution respect the information cutoff (same_close) | PASS |
| 18 | CL01 SYNTHETIC — 50% asset + 50% cash earns +1% on asset +2% (next_close) | PASS |
| 19 | CL01 SYNTHETIC — 100% asset earns full +2% (next_close) | PASS |
| 20 | CL01 SYNTHETIC — explicit 100% cash target earns only cash interest (next_close) | PASS |
| 21 | CL01 SYNTHETIC — constructor supports a 100% cash decision (next_close) | PASS |
| 22 | CL01 SYNTHETIC — mixed book reconciles positions, cash interest, costs and equity (next_close) | PASS |
| 23 | CL01 SYNTHETIC — cash objective refreshes only at monthly rebalances (next_close) | PASS |
| 24 | CL01 SYNTHETIC — built-in cash decision and execution respect the information cutoff (next_close) | PASS |
| 25 | CL01 SYNTHETIC — 50% asset + 50% cash earns +1% on asset +2% (next_open) | PASS |
| 26 | CL01 SYNTHETIC — 100% asset earns full +2% (next_open) | PASS |
| 27 | CL01 SYNTHETIC — explicit 100% cash target earns only cash interest (next_open) | PASS |
| 28 | CL01 SYNTHETIC — constructor supports a 100% cash decision (next_open) | PASS |
| 29 | CL01 SYNTHETIC — mixed book reconciles positions, cash interest, costs and equity (next_open) | PASS |
| 30 | CL01 SYNTHETIC — cash objective refreshes only at monthly rebalances (next_open) | PASS |
| 31 | CL01 SYNTHETIC — built-in cash decision and execution respect the information cutoff (next_open) | PASS |
| 32 | CL01 SYNTHETIC — explicit cash/risk target cannot consume future rows (same_close) | PASS |
| 33 | CL01 SYNTHETIC — explicit cash/risk target cannot consume future rows (next_close) | PASS |

### Resultado individual de las 15 regresiones nuevas

| # | Caso | Resultado |
|---|---|---|
| 34 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (same_close, without context) | PASS |
| 35 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (same_close, provideTargetContext) | PASS |
| 36 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (same_close, d5GrossTradeCosts) | PASS |
| 37 | CL01 FIX SYNTHETIC — existing holdings liquidate to 100% cash (same_close) | PASS |
| 38 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (next_close, without context) | PASS |
| 39 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (next_close, provideTargetContext) | PASS |
| 40 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (next_close, d5GrossTradeCosts) | PASS |
| 41 | CL01 FIX SYNTHETIC — existing holdings liquidate to 100% cash (next_close) | PASS |
| 42 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (next_open, without context) | PASS |
| 43 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (next_open, provideTargetContext) | PASS |
| 44 | CL01 FIX SYNTHETIC — callback cutoff and actual fill (next_open, d5GrossTradeCosts) | PASS |
| 45 | CL01 FIX SYNTHETIC — existing holdings liquidate to 100% cash (next_open) | PASS |
| 46 | CL01 FIX SYNTHETIC — zero-risk mandate permits no active ETFs and preserves output format | PASS |
| 47 | CL01 FIX SYNTHETIC — cash-only rejects positive ETF minima and invalid constraints | PASS |
| 48 | CL01 FIX SYNTHETIC — positive risk budgets retain eligibility and allocation constraints | PASS |

Los casos 34–36, 38–40 y 42–44 comprueban las listas de fechas completas visibles y ambos mecanismos de contexto. Para cierre ven 2026-01-01 a 2026-01-03; next_open también ve 2026-01-04. La política usa los datos recibidos sin filtrarlos. Los fills usan respectivamente 200/300/150, no el precio del corte; next_open gana el retorno apertura→cierre y cierre no atribuye movimiento previo a posiciones nuevas.

Las liquidaciones de los casos 37/41/45 pasan por el constructor real con mandato 100% cash y posición inicial AAA=1, cash=0, NAV=100. Ejecutan ventas de cantidad -1 y notional -110/-125/-120; dejan cero posiciones y cash neto 109.9175/124.90625/119.82 según la convención existente de cada modo. Verifican costos una vez, interés posterior solo sobre cash, cash por notionals, NAV y curva. El gap previo a la venta en apertura pertenece a la posición antigua; el movimiento posterior no genera P&L tras vender.

### Estado posterior por criterio y limitaciones

| Criterio original | Estado posterior | Evidencia |
|---|---|---|
| Exposición una vez, cash preservado | PASS | Casos 10–11,18,25 |
| 50/50 y retorno +1% | PASS | Casos 11,18,25 |
| Extremos cash/activo | PASS | Casos 12–14,19–21,26–28; mandato y rechazos 46–48; liquidaciones 37,41,45 |
| Conciliación contable | PASS | Casos 6,15,22,29,37,41,45 |
| Corte temporal y fills consistentes | PASS | Casos 7–8,17,24,31–36,38–40,42–44 |
| Objetivo en cada rebalanceo, sin trades implícitos | PASS | Casos 4,16,23,30 |

- Permanecen **NO VERIFICADOS** la agenda trimestral y caps de turnover vinculantes; una liquidación con cap vinculante puede ser parcial según la regla existente. No se cambió esa regla.
- Los rechazos de restricciones incompatibles cubren mínimos ETF positivos (también `1e-12`), cash fuera de rango, máximo ETF inválido, target inválido, mínimo negativo y restricciones de capacidad/eligibilidad con presupuesto positivo. No es una enumeración de todos los parámetros inválidos posibles.
- La prueba de presupuesto positivo cercano a `1e-12` acredita que no se activa la excepción cash-only y que se conservan los rechazos de elegibilidad/cantidad. **No certifica precisión relativa de distribución a esa escala**: los helpers mantienen sus tolerancias numéricas preexistentes. No se modificaron esas tolerancias.
- Los casos nuevos de contexto `d5GrossTradeCosts` verifican el corte y fill con costos cero; las liquidaciones comprueban las convenciones A1 existentes. No se abrió una auditoría de costos D5, políticas consumidoras ni otros backtests.
- No se corrió una suite general del monorepo ni se certificó un capital layer independiente. La cobertura es sintética, acotada a estos dos defectos y a los casos originales.

Archivos cambiados en este bloque: `calculator.ts`, el archivo nuevo `calculator.cl01-regressions.test.ts` y este reporte. `calculator.cl01.test.ts` permanece pendiente desde el bloque inicial y **sin edición**. No hubo producción, deploy, push, cambios de versión ni backtests históricos. Corrección y verificación concluidas.
