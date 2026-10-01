"""Normalize compact execution evidence for the PDF; no model execution."""
import json
import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
NAMES = {"assets": "Assets", "signals": "Assets + Signals", "alpha": "Alpha Streams"}


def first(mapping, *keys):
    for key in keys:
        if mapping.get(key) is not None:
            return mapping[key]
    return None


def normalize():
    source = json.loads((ROOT / "summary.json").read_text())
    prices = json.loads((ROOT / "source-price-status.response.json").read_text())
    watched = json.loads((ROOT / "watched-jobs.json").read_text())
    strategies = []
    for item in source["strategies"]:
        key = item["key"]
        job = watched[key]
        ids = item["ids"]
        if job["status"] in {"completed", "failed"} and job.get("validationRunId"):
            if ids.get("validationRunId") != job["validationRunId"]:
                raise RuntimeError(f"{key}: summary must be refreshed from final job")
        flags = item.get("flags", {})
        raw_metrics = item.get("metrics")
        valid = bool(raw_metrics and flags.get("financialStatus") == "success"
                     and flags.get("reconciliationStatus") == "pass"
                     and flags.get("fullDecisionCalendar") is True)
        state = job["status"]
        description = ""
        if valid:
            display = "Completo y conciliado"
            dates = item["actualDates"]
            description = (
                f'Validación {ids["validationRunId"]}. Ledger observado entre '
                f'{dates.get("ledgerStart")} y {dates.get("ledgerEnd")}; '
                f'{dates.get("decisionCount")} decisiones. '
                f'Conciliación: {flags.get("reconciliationStatus")}. '
                f'Reproducibilidad registrada: {flags.get("reproducibilityStatus")}.'
            )
        elif state in {"queued", "running", "READ_ERROR"}:
            display = "En cola" if state == "queued" else "En curso / pendiente"
            description = ("La ejecución todavía no tiene un resultado histórico "
                           "certificado. No se publican métricas provisionales.")
        else:
            display = "Fallido / no certificado"
            error = item.get("error") or job.get("error")
            error_message = error.get("message") if isinstance(error, dict) else error
            description = (
                f'La corrida no produjo un backtest aceptado. '
                f'Motivo registrado: {error_message or "Ver evidencia de validación"}. '
            )
            if error_message == "Invalid string length":
                description += (
                    "El resultado excedió un límite de serialización; es un fallo "
                    "de infraestructura, no una rentabilidad negativa ni una "
                    "validación financiera completada. No quedó una corrida "
                    "histórica guardada para publicar sus métricas."
                )
            elif error_message and error_message.startswith("B2 INFEASIBLE"):
                description += (
                    "El motor no encontró una asignación compatible con las "
                    "restricciones en esa fecha histórica. La corrida no completó "
                    "la conciliación y no tiene métricas publicables. No se "
                    "relajaron los límites de efectivo o exposición para ocultar "
                    "este resultado."
                )
        metrics = None
        equity = item.get("equity", []) if valid else []
        if valid:
            final = equity[-1]["nav"] if equity else first(raw_metrics, "finalNav", "endingNav")
            metrics = {
                "initialNav": source["assumptions"]["initialNav"],
                "finalNav": final,
                "totalReturn": final / source["assumptions"]["initialNav"] - 1
                if final is not None else first(raw_metrics, "totalReturn", "cumulativeReturn"),
                "cagr": first(raw_metrics, "annualizedReturn", "cagr", "CAGR"),
                "annualizedVolatility": first(raw_metrics, "annualizedVolatility",
                                             "volatility", "annualizedVol"),
                "maxDrawdown": first(raw_metrics, "maxDrawdown", "maximumDrawdown"),
                "sharpe": first(raw_metrics, "sharpeRatio", "sharpe"),
                "totalCosts": (item.get("totalCosts") or {}).get("total"),
            }
        current = item.get("currentAllocation")
        stale = current is None and item.get("latestExecutableReferenceAllocation") is not None
        allocation = current or item.get("latestExecutableReferenceAllocation")
        solved = allocation is not None and (
            item.get("currentAllocationStatus") == "SOLVED" or stale
        )
        weights = {row["ticker"]: row["weight"] for row in allocation["assets"]} if solved else {}
        cash = allocation["cash"] if solved else None
        if solved:
            assert math.isclose(sum(weights.values()) + cash, 1, abs_tol=1e-7), key
            assert all(math.isfinite(v) and v >= -1e-8 for v in weights.values())
            assert .1 - 1e-7 <= cash <= .2 + 1e-7
            assert all(v <= .3 + 1e-7 for v in weights.values())
        allocation_status = (
            "Referencia del 29/09; NO actualizada al 01/10" if stale else
            "Optimización 01/10; mapas de señales del 01/09" if solved and key == "alpha" else
            "Resuelta para el 01/10" if solved else "No disponible"
        )
        methodology = {
            "assets": "Rendimientos históricos diarios como pronóstico de rentabilidad "
                      "(SAMPLE_MEAN), con optimización media-varianza long-only.",
            "signals": "Rendimientos de assets y pronóstico SIGNAL_RIDGE. Se utilizan "
                       "Momentum y Mean Reversion, con regularización Ridge 1, "
                       "ventana de entrenamiento de 252 fechas y mínimo de 60. "
                       "Las señales no se tratan como capital invertible.",
            "alpha": "Dos streams long-only cross-sectional: Momentum y Mean Reversion, "
                     "sobre el mismo universo. Señal oriented, umbral 0, fracción bruta 1, "
                     "rebalanceo mensual y ejecución next_close. Se optimizan los streams "
                     "y se consolidan sus exposiciones en los ETFs subyacentes.",
        }[key]
        warnings = []
        if stale:
            warnings.append(
                "El objetivo de Signals mostrado corresponde a decisión 29/09/2026, "
                "con información hasta 28/09/2026. El motor requiere una observación "
                "posterior para next_close y no permite el objetivo solicitado del 01/10 "
                "con este calendario. No se añadieron precios futuros ficticios."
            )
        if key == "alpha":
            warnings.append(
                "La optimización utiliza rendimientos hasta el 30/09, pero proyecta "
                "los streams mediante sus últimos mapas guardados: señal 01/09, "
                "corte 31/08 y ejecución prevista 02/09. No reconstruye nuevas "
                "señales Alpha para el 01/10."
            )
        strategies.append({
            "name": NAMES[key], "key": key, "methodology": methodology,
            "backtest": {
                "displayStatus": display, "description": description, "valid": valid,
                "metrics": metrics, "equity": equity,
                "warnings": ["No se ejecutó un replay adicional para este informe."],
            },
            "allocation": {
                "displayStatus": allocation_status, "solved": solved,
                "weights": weights, "cash": cash,
                "informationCutoff": allocation["informationCutoff"] if solved else None,
                "decisionDate": allocation["decisionTimestamp"][:10] if solved else None,
                "warnings": warnings,
            },
            "evidence": {
                "inputs": f'B1 {ids.get("preparedInputId")}; B2 {ids.get("allocationId")}',
                "validation": (
                    f'B3 {ids["validationRunId"]}; {display}'
                    if ids.get("validationRunId") else
                    f'Sin corrida B3 guardada; {display}'
                ),
            },
        })
    count = sum(s["backtest"]["valid"] for s in strategies)
    statement = (
        f"{count} de 3 validaciones históricas completas y conciliadas. "
        "La comparación solicitada no está completa." if count != 3 else
        "Las tres validaciones históricas están completas y conciliadas. "
        "Las asignaciones tienen límites de actualización que se detallan abajo."
    )
    data = {
        "partial": count != 3,
        "statusAsOf": datetime.fromisoformat(source["generatedAt"].replace("Z", "+00:00"))
            .astimezone(ZoneInfo("America/Buenos_Aires")).strftime("%d/%m/%Y %H:%M (Argentina)"),
        "executiveSummary": statement + " Se muestran únicamente resultados y "
            "asignaciones respaldados por ejecuciones guardadas. Las fechas de "
            "las asignaciones se indican expresamente.",
        "strategies": strategies,
        "universe": source["universe"],
        "exclusionExplanation": "XLC y XLRE quedan fuera del universo común: no "
            "aportan las 509 observaciones consecutivas anteriores al 01/10/2016 "
            "exigidas para el calentamiento de los modelos. XLC comienza en 2018; "
            "XLRE dispone de 248 observaciones previas. La selección no utilizó "
            "su rentabilidad posterior.",
        "assumptions": [
            ["Período", "01/10/2016–30/09/2026; historia previa conservada para entrenamiento"],
            ["Capital inicial", "USD 100.000, inicialmente 100% efectivo"],
            ["Rebalanceo / ejecución", "Mensual / next_close"],
            ["Costos", "10 bps de comisión + 5 bps de deslizamiento sobre el turnover unilateral del motor"],
            ["Efectivo", "Rentabilidad 0; límite objetivo 10%–20%"],
            ["Exposición por ETF", "Máximo 30%; sin posiciones cortas"],
            ["Objetivo final", "Media-varianza regularizada; gamma 100, eta 0"],
            ["Estimación", "252 observaciones; mínimo 60; shrinkage diagonal 0,20"],
            ["Factores finales", "Momentum y Mean Reversion; biblioteca congelada v1.4"],
            ["Benchmark configurado", "SPY, buy-and-hold bruto; no se deducen costos del benchmark"],
        ],
        "methodologyNotes": [
            "Los primeros intentos utilizaron gamma 1 y después gamma 10. La "
            "configuración final gamma 100 se eligió tras fallos de certificación "
            "numérica, no por maximizar resultados. Cambia la aversión al riesgo "
            "y no debe interpretarse como una comparación contra los intentos previos.",
            "Se redujeron siete factores a dos para limitar el tamaño de los "
            "snapshots y el trabajo de cálculo. Se mantuvieron los datos y la "
            "biblioteca original; esta comparación no representa el modelo completo "
            "de siete factores.",
            "B3 reconstruye las decisiones con los cortes históricos. No impone "
            "retrospectivamente los pesos actuales a los diez años. Las comisiones "
            "de los streams B1 no se suman otra vez: B3 cobra sobre las operaciones "
            "consolidadas de los activos subyacentes.",
            "Convención de costos: turnover unilateral = 0,5 × suma de cambios "
            "absolutos de los pesos objetivo consolidados. No equivale a cobrar "
            "15 bps sobre cada dólar de cada compra y venta; se reportan los "
            "importes efectivamente registrados por el ledger del motor.",
            "Anualización: rentabilidad compuesta sobre días del ledger/252, "
            "volatilidad muestral diaria × raíz de 252 y Sharpe sobre rendimientos "
            "netos diarios con rendimiento del efectivo igual a cero.",
            "No se impone la regla legacy de nueve posiciones ni un peso mínimo "
            "de 0,5% por ETF. No se modificó la configuración global de la cartera.",
        ],
        "source": {
            "id": source["provenance"]["datasetId"],
            "sha256": source["provenance"]["datasetHash"],
            "startDate": source["provenance"]["sourceCoverage"][0],
            "endDate": source["provenance"]["sourceCoverage"][1],
            "rowCount": prices["rowCount"],
            "provenance": "El archivo contiene precios de cierre ajustados, pero "
                "el proveedor original no consta en sus metadatos persistidos. "
                "No se afirma que sea un dataset de mercado verificado ni que sea "
                "sintético. Los resultados están condicionados a este archivo.",
        },
        "failures": [
            *([s["name"] + ": " + s["backtest"]["description"]
               for s in strategies if not s["backtest"]["valid"]]),
            "Los intentos iniciales de Assets con gamma 1 fallaron la certificación "
            "numérica. Con gamma 10 se obtuvo un objetivo actual, pero la validación "
            "B3 546 falló en la decisión del 02/02/2026; no generó métricas válidas.",
            "El objetivo de Signals para 01/10/2026 fue rechazado por el límite "
            "del calendario next_close. Su referencia anterior se mantiene "
            "separada de las asignaciones actuales.",
            "La preparación original de siete Alpha Streams devolvió HTTP 422 "
            "al guardarse un snapshot muy grande. La respuesta no expone la "
            "causa interna del driver; el tamaño es una sospecha, no un diagnóstico "
            "confirmado. La preparación reducida a dos streams sí quedó guardada.",
        ],
    }
    (ROOT / "report-data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2)
    )
    print(f"Normalized {count}/3 complete backtests; allocation totals verified.")


if __name__ == "__main__":
    normalize()