"""One-page manual allocation adjustment, preserving the original frozen B2."""
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
holdings = sorted([(k, v) for k, v in r["assetWeights"].items() if v > 1e-10],
                  key=lambda x: x[1], reverse=True)
top = holdings[:6]
moved_to_cash = sum(value for _, value in holdings[6:])
cash = r["totalCash"] + moved_to_cash
invested = sum(value for _, value in top)
assert math.isclose(invested + cash, 1, abs_tol=1e-8)
audit["manualAdjustment"] = {
    "type": "move_other_etfs_to_cash",
    "assetWeights": dict(top),
    "cash": cash,
    "movedToCash": moved_to_cash,
    "removedAssetWeights": dict(holdings[6:]),
    "reoptimized": False,
    "executed": False,
}
(ROOT / "alpha-onepage-data.json").write_text(json.dumps(audit, indent=2))

OUT = ROOT / "Alpha_Streams_1_Pagina_Octubre_2026.pdf"
c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle("Alpha Streams — asignación de capital")
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
text(42, 86, "Asignación ajustada · 6 ETFs y efectivo", 11, MUTED)
rect(42, 103, W-84, 33, "#F0F4F8")
text(52, 117, "Decisión 01/10/2026 · datos al 30/09 · mapas de señales del 01/09", 8)
text(52, 129, "Ajuste manual sobre B2 · sin reoptimizar ni ejecutar operaciones.", 7.5)

for x, value, caption in [
    (42, percent(invested), "Capital asignado a ETFs"),
    (214, percent(cash), "Efectivo"),
    (391, str(len(top)), "ETFs seleccionados"),
]:
    text(x, 192, value, 25, NAVY, True)
    text(x, 214, caption, 8, MUTED)
line(42, 244, W-42, 244)

text(42, 278, "Asignación de capital", 12, NAVY, True)
text(330, 278, "Exposición a ETFs", 12, NAVY, True)
cx, cy, radius = 168, H-427, 113
start = 90
for value, color in zip([invested, cash], [PALETTE[0], PALETTE[2]]):
    c.setFillColor(colors.HexColor(color))
    c.setStrokeColor(colors.white)
    c.setLineWidth(1.5)
    c.wedge(cx-radius, cy-radius, cx+radius, cy+radius,
            startAng=start, extent=-360*value, fill=1, stroke=1)
    start -= 360*value
for i, (label, value, color) in enumerate(zip(
    ["ETFs seleccionados", "Efectivo"], [invested, cash], [PALETTE[0], PALETTE[2]]
)):
    y = 580+i*27
    rect(62, y-7, 8, 8, color)
    text(78, y, label, 9)
    text(280, y, percent(value), 10, INK, True, right=True)

table = top + [("Efectivo", cash), ("Total", invested+cash)]
for i, (ticker, value) in enumerate(table):
    y = 325 + i*43
    if i % 2 == 0:
        rect(324, y-19, 229, 36, "#F0F4F8")
    text(332, y+1, ticker, 10)
    text(543, y+1, percent(value), 10, right=True)
text(330, 665, "% del capital total; exposición consolidada.", 7, MUTED)
line(42, 697, W-42, 697)
text(42, 811, "Fuente: B2 325 · Dataset 22 · Procedencia de precios no verificada.", 7, MUTED)
text(W-42, 811, "1 / 1", 7, MUTED, right=True)
c.showPage()
c.save()
print(OUT)
print(json.dumps(audit, indent=2))