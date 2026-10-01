"""Render verified, normalized run evidence; never manufacture absent returns."""
import json
from pathlib import Path
from pdf_layout import (
    ROOT, p, pct, usd, number, table, notice, build_pdf, Spacer, PageBreak,
)
from pdf_charts import nav_chart


def render(data):
    strategies = data["strategies"]
    story = [
        p("Informe parcial\nBacktests: octubre 2026" if data.get("partial") else
          "Tres estrategias.\nDiez años solicitados.", "title"),
        p("Assets · Assets + Signals · Alpha Streams", "subtitle"),
        p("Período solicitado: 01/10/2016–30/09/2026\n"
          "Asignación solicitada: 01/10/2026\n"
          "Último cierre en los datos: 30/09/2026"),
        p("Estado verificado al " + data["statusAsOf"] + ".", "small"),
        notice(data["executiveSummary"]),
        Spacer(1, 12),
        p("1. Estado de las ejecuciones", "h1"),
        table(
            ["Estrategia", "Backtest de diez años", "Asignación del modelo"],
            [[s["name"], s["backtest"]["displayStatus"],
              s["allocation"]["displayStatus"]] for s in strategies],
            [112, 186, 193],
        ),
        Spacer(1, 10),
        p("No se ejecutaron compras ni ventas reales. Los pesos mostrados son "
          "objetivos matemáticos del modelo, no órdenes enviadas a un intermediario."),
        p("Este informe es exclusivamente informativo. No constituye asesoramiento "
          "de inversión ni una recomendación de comprar, vender o mantener valores. "
          "Los resultados históricos no garantizan resultados futuros.", "small"),
        PageBreak(),
        p("2. Resultados históricos", "h1"),
        p("Sólo se muestran métricas de corridas completas aceptadas por el motor. "
          "N/D significa que no existe un resultado histórico válido; no equivale "
          "a una rentabilidad de cero."),
    ]
    definitions = [
        ("Capital inicial", "initialNav", usd),
        ("Capital final neto", "finalNav", usd),
        ("Rentabilidad acumulada", "totalReturn", pct),
        ("Rent. anualizada", "cagr", pct),
        ("Volatilidad anualizada", "annualizedVolatility", pct),
        ("Máxima caída", "maxDrawdown", pct),
        ("Sharpe", "sharpe", number),
        ("Costos acumulados", "totalCosts", usd),
    ]
    rows = []
    for label, key, formatter in definitions:
        row = [label]
        for s in strategies:
            bt = s["backtest"]
            metrics = bt.get("metrics") if bt.get("valid") else None
            row.append(formatter(metrics.get(key) if metrics else None))
        rows.append(row)
    story.append(table(["Métrica"] + [s["name"] for s in strategies], rows,
                       [151, 108, 116, 116]))
    for s in strategies:
        bt = s["backtest"]
        story += [p(s["name"], "h2"), p(bt["description"])]
        for warning in bt.get("warnings", []):
            story.append(p(warning, "small"))
    story += [
        p("Criterio de interpretación", "h2"),
        p("Una corrida fallida o incompleta no permite ordenar estrategias, "
          "comparar CAGR o Sharpe, ni concluir que una alternativa sea superior. "
          "Una asignación actual resuelta tampoco demuestra que su política haya "
          "superado la validación histórica."),
    ]
    chart = nav_chart(strategies)
    if chart is not None:
        story += [
            p("Trayectoria de las corridas completas", "h2"),
            chart,
            p("Se utiliza cada observación diaria disponible de las corridas "
              "completas, con sus fechas reales. Se omiten series fallidas o "
              "pendientes; no se les atribuye una trayectoria estimada.", "small"),
        ]
    story += [
        PageBreak(), p("3. Asignaciones calculadas", "h1"),
        p("Porcentaje del capital total, incluyendo efectivo. Se distingue la "
          "fecha de decisión del último dato utilizado. Una decisión anterior "
          "no se presenta como una actualización al 1 de octubre."),
    ]
    for s in strategies:
        a = s["allocation"]
        story.append(p(
            f'{s["name"]}: {a["displayStatus"]}. '
            f'Dato de corte: {a.get("informationCutoff") or "N/D"}. '
            f'Decisión: {a.get("decisionDate") or "N/D"}.', "small"
        ))
    tickers = sorted(set(t for s in strategies
                         for t in (s["allocation"].get("weights") or {})))
    # Omit all-zero rows only; the disclosure below states the convention.
    shown = [t for t in tickers if any(
        abs((s["allocation"].get("weights") or {}).get(t, 0)) > 1e-10
        for s in strategies
    )]
    rows = []
    for t in shown:
        rows.append([t] + [
            pct((s["allocation"].get("weights") or {}).get(t, 0))
            if s["allocation"].get("solved") else "N/D" for s in strategies
        ])
    rows.append(["Efectivo"] + [
        pct(s["allocation"].get("cash"))
        if s["allocation"].get("solved") else "N/D" for s in strategies
    ])
    rows.append(["Total"] + [
        pct(sum(s["allocation"]["weights"].values()) + s["allocation"]["cash"])
        if s["allocation"].get("solved") else "N/D" for s in strategies
    ])
    story.append(table(["Activo"] + [s["name"] for s in strategies], rows,
                       [151, 108, 116, 116]))
    story.append(p(
        "Se omiten únicamente activos con peso cero en todas las asignaciones "
        "resueltas. Los porcentajes se redondean a dos decimales; el total se "
        "verifica con valores sin redondear. No son las posiciones finales de un "
        "backtest: son decisiones independientes calculadas con los cortes indicados.",
        "small",
    ))
    for s in strategies:
        for warning in s["allocation"].get("warnings", []):
            story.append(p(f'{s["name"]}: {warning}', "small"))
    story += [PageBreak(), p("4. Metodología y alcance", "h1")]
    story.append(table(["Supuesto", "Configuración"], data["assumptions"], [151, 340]))
    story += [
        p("Universo común", "h2"), p(", ".join(data["universe"])),
        p(data["exclusionExplanation"]),
        p("Diferencia entre las estrategias", "h2"),
    ]
    for s in strategies:
        story += [p(s["name"], "h2"), p(s["methodology"])]
    for note in data.get("methodologyNotes", []):
        story.append(p(note, "small"))
    story += [PageBreak(), p("5. Evidencia, límites y fuentes", "h1")]
    source = data["source"]
    story += [
        p(f'Dataset: {source["id"]}. Cobertura: {source["startDate"]}–'
          f'{source["endDate"]}. Filas: {source["rowCount"]:,}.'),
        p("SHA-256 del dataset:\n" + source["sha256"], "small"),
        notice(source["provenance"]),
        Spacer(1, 10),
        table(
            ["Estrategia", "Preparación / asignación", "Validación / estado"],
            [[s["name"], s["evidence"]["inputs"], s["evidence"]["validation"]]
             for s in strategies], [112, 180, 199],
        ),
        Spacer(1, 10),
        p("Lectura de los bloqueos", "h2"),
    ]
    for item in data.get("failures", []):
        story.append(p(item))
    story += [
        p("Limitaciones", "h2"),
        p("El universo se eligió entre los instrumentos disponibles hoy que "
          "contaban con suficiente historia antes del inicio solicitado. Esto "
          "no elimina el sesgo de supervivencia ni reconstruye el universo "
          "invertible que un inversor habría conocido en 2016. Los parámetros "
          "y las definiciones actuales de los factores tampoco constituyen una "
          "selección ex ante documentada en 2016."),
        p("Los costos son supuestos constantes, no mediciones de liquidez, "
          "spread o impacto de mercado. No se modelan impuestos personales. "
          "No se verificó de forma independiente la procedencia del archivo de "
          "precios; por ello no se certifica su exactitud ni su integridad."),
        p("Aviso final", "h2"),
        p("Este documento es una investigación de modelos y no asesoramiento "
          "financiero personalizado. Cualquier inversión puede perder valor, "
          "incluido el capital inicial. Una simulación no reproduce todas las "
          "condiciones de una ejecución real. Antes de tomar decisiones, consulte "
          "a un asesor financiero habilitado que evalúe su situación, objetivos "
          "y tolerancia al riesgo."),
        p("Fuente de los números y estados: respuestas guardadas de Allocation "
          "Lab, preparaciones B1, asignaciones B2 y validaciones B3. Los "
          "identificadores permiten localizar la evidencia en el proyecto. "
          "No se utilizaron resultados de sesiones legacy como sustituto.", "small"),
    ]
    return build_pdf(story, filename=(
        "Informe_Parcial_Backtests_Octubre_2026.pdf" if data.get("partial") else
        "Comparacion_Backtests_Octubre_2026.pdf"
    ))


if __name__ == "__main__":
    print(render(json.loads((ROOT / "report-data.json").read_text())))