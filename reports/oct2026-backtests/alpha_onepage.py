"""One-page Alpha Streams allocation and model attribution from frozen B2."""
import json
import math
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from pdf_layout import ROOT  # Also registers the embedded DejaVu fonts.

raw = json.loads((ROOT / "alpha-allocation.response.json").read_text())
summary = json.loads((ROOT / "summary.json").read_text())
alpha = next(s for s in summary["strategies"] if s["key"] == "alpha")
r = raw["result"]
m = r["model"]
defs = {d["candidateId"]: d["factorId"] for d in alpha["alphaCandidateDefinitions"]}
names = {"momentum": "Momentum", "mean_reversion": "Mean Reversion"}
ids = m["candidateIds"]
labels = [names[defs[i]] for i in ids]
w = [r["candidateWeights"][i] for i in ids]
contribution = [w[i] * m["mu"][i] for i in range(len(w))]
se = [w[i] * r["forecast"]["standardErrors"][i] for i in range(len(w))]
sigma_w = [sum(m["sigma"][i][j] * w[j] for j in range(len(w))) for i in range(len(w))]
variance_parts = [w[i] * sigma_w[i] for i in range(len(w))]
variance = sum(variance_parts)
risk_share = [v / variance for v in variance_parts]
cash = r["totalCash"]
assert math.isclose(sum(w) + cash, 1, abs_tol=1e-8)
assert math.isclose(sum(contribution), r["estimatedGrossReturn"], abs_tol=1e-12)
assert math.isclose(math.sqrt(variance), r["estimatedVolatility"], abs_tol=1e-12)
assert math.isclose(sum(risk_share), 1, abs_tol=1e-12)
assert all(v >= 0 for v in risk_share)
audit = {
    "allocationId": raw["id"], "candidateIds": ids, "labels": labels,
    "weights": w, "cash": cash, "dailyGrossReturnContribution": contribution,
    "dailyContributionStandardErrors": se, "varianceContributions": variance_parts,
    "varianceShares": risk_share, "informationCutoff": m["informationCutoff"],
    "mappingSignalDate": "2026-09-01",
}
(ROOT / "alpha-onepage-data.json").write_text(json.dumps(audit, indent=2))

OUT = ROOT / "Alpha_Streams_1_Pagina_Octubre_2026.pdf"
c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle("Alpha Streams — asignación y atribución del modelo")
c.setAuthor("Allocation Lab")
W, H = A4
NAVY, INK, MUTED = "#1E3158", "#253448", "#59687B"
PALETTE = ["#61A9BD", "#CED14E", "#44986D"]


def text(x, y, value, size=9, color=INK, bold=False, right=False):
    c.setFont("DejaVuBold" if bold else "DejaVu", size)
    c.setFillColor(colors.HexColor(color))
    (c.drawRightString if right else c.drawString)(x, H-y, str(value))


def line(x1, y1, x2, y2, color="#DDE5EE", width=.5):
    c.setStrokeColor(colors.HexColor(color))
    c.setLineWidth(width)
    c.line(x1, H-y1, x2, H-y2)


def rect(x, y, width, height, color):
    c.setFillColor(colors.HexColor(color))
    c.rect(x, H-y-height, width, height, fill=1, stroke=0)


def num(v, places=2):
    return f"{v:.{places}f}".replace(".", ",")


def percent(v):
    return num(v*100) + "%"


rect(0, 0, W, 9, NAVY)
text(42, 34, "ALLOCATION LAB  /  OCTUBRE 2026", 8, MUTED, True)
text(42, 65, "Alpha Streams", 29, NAVY, True)
text(42, 86, "Asignación de capital y atribución del modelo", 11, MUTED)
rect(42, 103, W-84, 33, "#F0F4F8")
text(52, 117, "Decisión 01/10/2026 · datos al 30/09 · mapas de señales del 01/09", 8)
text(52, 129, "Objetivo no ejecutado. Backtest de 10 años no válido: infactible el 01/08/2022.", 7.5)

for x, value, caption in [
    (42, percent(sum(w)), "Capital asignado a streams"),
    (214, num(sum(contribution)*10000) + " pb", "Retorno bruto estimado / día"),
    (391, percent(math.sqrt(variance)), "Volatilidad modelada / día"),
]:
    text(x, 169, value, 21, NAVY, True)
    text(x, 186, caption, 7.3, MUTED)
line(42, 202, W-42, 202)

text(42, 226, "Asignación por stream", 12, NAVY, True)
text(330, 226, "Exposición a ETFs", 12, NAVY, True)
cx, cy, radius = 168, H-297, 62
start = 90
for value, color in zip(w+[cash], PALETTE):
    c.setFillColor(colors.HexColor(color))
    c.setStrokeColor(colors.white)
    c.setLineWidth(1.5)
    c.wedge(cx-radius, cy-radius, cx+radius, cy+radius,
            startAng=start, extent=-360*value, fill=1, stroke=1)
    start -= 360*value
for i, (label, value, color) in enumerate(zip(labels+["Efectivo"], w+[cash], PALETTE)):
    y = 381+i*15
    rect(62, y-7, 8, 8, color)
    text(78, y, label, 8)
    text(280, y, percent(value), 9, INK, True, right=True)

holdings = sorted([(k, v) for k, v in r["assetWeights"].items() if v > 1e-10],
                  key=lambda x: x[1], reverse=True)
top = holdings[:6]
table = top + [(f"Otros {len(holdings)-6} ETFs", sum(v for _, v in holdings[6:])),
               ("Efectivo", cash)]
for i, (ticker, value) in enumerate(table):
    y = 249 + i*21
    if i % 2 == 0:
        rect(324, y-12, 229, 20, "#F0F4F8")
    text(332, y+1, ticker, 8.5)
    text(543, y+1, percent(value), 9, right=True)
text(330, 422, "% del capital total; exposición consolidada.", 6.9, MUTED)
line(42, 439, W-42, 439)

text(42, 464, "Contribución al retorno estimado", 12, NAVY, True)
text(42, 480, "Bruto, pb/día · líneas: intervalo de estimación aprox. 95% (±1,96 EE)", 7.5, MUTED)
returns_bps = [v*10000 for v in contribution]
errors_bps = [1.96*v*10000 for v in se]
low = math.floor(min(0, min(v-e for v, e in zip(returns_bps, errors_bps))))
high = math.ceil(max(v+e for v, e in zip(returns_bps, errors_bps))) + 1
px, pw = 157, 371
xx = lambda value: px + (value-low)/(high-low)*pw
for tick in range(low, high+1, 2):
    line(xx(tick), 492, xx(tick), 551, "#E4EAF0")
    text(xx(tick)-4, 565, str(tick), 7, MUTED)
line(xx(0), 492, xx(0), 551, MUTED, .8)
for i, label in enumerate(labels):
    y = 506+i*30
    text(42, y+3, label, 8)
    v, e = returns_bps[i], errors_bps[i]
    rect(min(xx(0), xx(v)), y-6, abs(xx(v)-xx(0)), 12, "#61A9BD")
    line(xx(v-e), y, xx(v+e), y, "#3C7686", 1.1)
    for end in [v-e, v+e]:
        line(xx(end), y-4, xx(end), y+4, "#3C7686", 1.1)
    text(551, y+3, num(v), 8, NAVY, True, right=True)
text(42, 585, "Total: " + num(sum(returns_bps)) + " pb/día. Atribución wᵢ × μᵢ; no es rentabilidad realizada.", 7.5, MUTED)

text(42, 618, "Contribución al riesgo", 12, NAVY, True)
text(42, 634, "Participación en la varianza del portfolio, incluyendo covarianzas", 7.5, MUTED)
for tick in [0, 25, 50, 75, 100]:
    x = px + pw*tick/100
    line(x, 644, x, 700, "#E4EAF0")
    text(x-7, 714, str(tick)+"%", 7, MUTED)
for i, label in enumerate(labels):
    y = 658+i*30
    text(42, y+3, label, 8)
    rect(px, y-6, pw*risk_share[i], 12, "#61A9BD")
    text(551, y+3, percent(risk_share[i]), 8, NAVY, True, right=True)

line(42, 737, W-42, 737)
text(42, 755, "Base: 252 observaciones, 30/09/2025–30/09/2026. Media histórica; gamma 100.", 7.2, MUTED)
text(42, 769, "Riesgo: wᵢ(Σw)ᵢ / (wᵀΣw). Efectivo: retorno y contribución al riesgo iguales a cero.", 7.2, MUTED)
text(42, 783, "Las barras describen la asignación B2, no la atribución de un backtest completado.", 7.2, MUTED)
text(42, 811, "Fuente: B2 325 · Dataset 22 · Procedencia de precios no verificada.", 7, MUTED)
text(W-42, 811, "1 / 1", 7, MUTED, right=True)
c.showPage()
c.save()
print(OUT)
print(json.dumps(audit, indent=2))