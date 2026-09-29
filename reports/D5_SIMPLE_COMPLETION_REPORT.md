# D5 SIMPLE COMPLETION REPORT — BLOCKED

**Verificación final:** 2026-09-29. **Revisión de la aplicación:** `d0e33da`; no se modificó código de aplicación ni se reactivó D5-L1. Quedó una corrección **sólo de pruebas**, sin commit, en `artifacts/api-server/src/lib/validation-runs.a21.test.ts` (SHA-256 final `3f91f9dbba37574410f9c0771319cd8f2117be1868aec0791082d00abb600016`). El informe histórico `D5_COMPLETION_REPORT_BLOCKED.md` sigue refiriéndose únicamente al objetivo L1 retirado.

## A2.1: causa y corrección

Ambas pruebas anteriores fijaban `endDate=2009-05-01` y `warmupDays=60`, pero `/run` congelaba el último CSV global, cuya cobertura comprobada era **2025-08-22–2026-09-25**, 275 filas y 22 tickers. Por tanto, el snapshot elegido no tenía ninguna cotización anterior a la fecha pedida. No se desactivó la validación de datos ausentes ni se alteraron fechas de producción.

El fixture corregido genera precios deterministas para los ETFs habilitados con cobertura **2008-01-01–2009-06-30**, inserta un dataset propio en PostgreSQL, confirma que es el elegido por `/run`, crea el snapshot inmutable mediante esa ruta real, y verifica que la validación congela su ID/cobertura. Captura IDs dinámicos; restaura el valor y `updated_at` originales de `constraints` inmediatamente después de crear el snapshot. Al finalizar elimina solamente el CSV, la sesión etiquetada y las validaciones pertenecientes a **esa** ejecución. Se comprobó que el CSV creado ya no era el último: el estado de precios volvió a mostrar 2025-08-22–2026-09-25. No se eliminaron sesiones etiquetadas de verificaciones anteriores (IDs 38 y 39, fechadas 2026-09-25), porque no pertenecen a esta prueba.

En el primer intento posterior a corregir las fechas, **A2.1-1 pasó**; A2.1-2 recuperó el resultado, pero el proceso lector excedió el buffer predeterminado de salida de Node (`ENOBUFS`). La única reparación adicional fue ampliar `maxBuffer` a 16 MiB en ese proceso lector, sin cambiar la aplicación ni las aserciones. Verificación final: **A2.1-1 PASS, A2.1-2 PASS (2/2)**. V1 y V2 conservaron IDs separados, idéntica identidad del dataset y costes distintos; V1 quedó íntegra tras V2. Un proceso Node nuevo recuperó por ID los supuestos, identidad y resultados persistidos, con las comprobaciones numéricas existentes de tolerancia `1e-8`.

## Puertas de aceptación D5 SIMPLE

| Puerta | Esperado | Observado |
|---|---|---|
| T1 identidad con λR=0/off | D4 sin cambio, cuatro combinaciones y reproducción histórica ≤`1e-8` | **PASS** en las pruebas D4/D5 SIMPLE y compatibilidad archivada. |
| T2 penalización analítica | Óptimo 0,60 sin penalización, 1/3 con λR=0,04; derivadas/objetivo y ningún débito de efectivo | **PASS** en `allocation-b2` y pruebas del historial D5 SIMPLE. |
| T3 agregación subyacente | Igual penalización para exposiciones equivalentes; holdings desplazados/liquidación externa sin doble cargo | **PASS** en pruebas signed-overlay y D5 SIMPLE. |
| T4 seguridad/tiempo | Restricciones y optimalidad independientes; fallos explícitos; sin mirar al futuro | **PASS** en pruebas B2, D4 y D5 SIMPLE. |
| T5 comparación histórica | Dos políticas con rutas propias, ≥2 ejecuciones y ambos libros conciliados ≤`1e-8` | **PASS**: validación guardada #489, 4 decisiones con fecha de ejecución; máximo de conciliación **1,4551915228366852×10⁻¹¹** tanto para λR positivo como para el par λR=0. No se exige que una política gane. |
| T6 navegador y replay | Optimizar y guardar en navegador; modificar borrador; cliente nuevo; replay de asignación **y** validación con diferencias ≤`1e-8` | **BLOCKED**: asignación #273 replay **PASS**, 0 campos distintos y diferencia numérica máxima **0**; replay de validación #489 devolvió **HTTP 502** en navegador. Diferencia de replay B3 **no disponible**. |

La preparación fresca #299 (política) y #300 (evaluación), ocho candidatos `alpha_streams`, se conservó hasta finalizar la verificación. En el navegador, B2 #273 se creó como `SIGNED_OVERLAY`, riesgo `SAMPLE`, robusto κ=0,5, λR=0,01, holdings explícitos, estado `SOLVED`; violación máxima de restricciones `6,938893903907228×10⁻¹⁸`. B3 #489 fue creada y guardada desde ese B2 con las fechas 2022-08-29–2022-11-26, conciliación `pass` y comparación λR=0. Tras cambiar **sin guardar** el borrador a λR=0,02 y cantidad D5A=101, un contexto de navegador nuevo reprodujo la asignación congelada. El replay B3 no completó: la UI mostró `HTTP 502`. Los registros de la API consultados no mostraron una respuesta del endpoint de replay B3 en esa ventana; eso **no** establece por sí solo la causa del 502. No se reintentó hasta obtener verde ni se modificó producción.

## Verificación ejecutada y límite de cierre

- **Ejecutado sobre el mismo código de aplicación:** 22 archivos de prueba, **123 PASS, 0 FAIL, 0 SKIP**. A1 `7`; A2 `7`; A2.1 `2`; B1 `8`; B2 `13`; B3 `14+3`; D1 `4+5`; D2 `9+5`; D3 `8+3+1+4`; D4 `10+2+4`; D5 `4+4+4`; rutas de asignación `2`. Las pruebas D5-L1 obsoletas **no** se ejecutaron como criterios de aceptación. No se reutilizaron como PASS los logs históricos ausentes.
- **Typecheck del workspace: PASS** (`pnpm run typecheck`, bibliotecas y cuatro proyectos). Los tres workflows seguían ejecutándose y la aplicación cargó en `/portfolio-lab`.
- El detalle de esta ejecución queda preservado en este informe (conteos por familia, IDs, criterios, diferencias y bloqueo); la salida cruda temporal de Node no constituye evidencia histórica reutilizable.

**Bloqueo exacto:** T6 exige un replay B3 visible y exitoso en un cliente nuevo, pero el navegador recibió HTTP 502 al reproducir la validación #489; no existe medición de la diferencia numérica de ese replay. Conforme al límite de una reparación y una verificación final, **D5 SIMPLE BLOCKED. STOP.** No se inició D6.