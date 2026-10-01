"""Static PDF charts from verified daily NAV only; no invented interpolation."""
from datetime import date
from reportlab.graphics.shapes import Drawing, Line, String, PolyLine
from reportlab.lib import colors

PALETTE = ["#3C7686", "#A3A537", "#2E6B4D"]


def nav_chart(strategies):
    series = []
    for index, strategy in enumerate(strategies):
        if not strategy["backtest"].get("valid"):
            continue
        points = strategy["backtest"].get("equity", [])
        if not points:
            continue
        series.append((strategy["name"], PALETTE[index], [
            (date.fromisoformat(row["date"]).toordinal(), row["nav"])
            for row in points
        ]))
    if not series:
        return None
    xmin = min(points[0][0] for _, _, points in series)
    xmax = max(points[-1][0] for _, _, points in series)
    values = [v for _, _, points in series for _, v in points]
    ymin, ymax = min(values), max(values)
    pad = max((ymax - ymin) * .07, 1000)
    ymin, ymax = ymin - pad, ymax + pad
    drawing = Drawing(491, 248)
    left, bottom, width, height = 65, 42, 410, 166
    x = lambda v: left + (v - xmin) / max(xmax - xmin, 1) * width
    y = lambda v: bottom + (v - ymin) / max(ymax - ymin, 1) * height
    ink = colors.HexColor("#59687B")
    for i in range(5):
        value = ymin + (ymax - ymin) * i / 4
        yy = y(value)
        drawing.add(Line(left, yy, left + width, yy,
                         strokeColor=colors.HexColor("#E4EAF0"), strokeWidth=.4))
        drawing.add(String(left - 7, yy - 3, f"{value / 1000:,.0f} mil",
                           fontName="DejaVu", fontSize=7, textAnchor="end",
                           fillColor=ink))
    for year in range(date.fromordinal(xmin).year + 1,
                      date.fromordinal(xmax).year + 1, 2):
        ordinal = date(year, 1, 1).toordinal()
        drawing.add(String(x(ordinal), bottom - 17, str(year), fontName="DejaVu",
                           fontSize=7, textAnchor="middle", fillColor=ink))
    for name, color, points in series:
        coords = [v for xx, yy in points for v in (x(xx), y(yy))]
        drawing.add(PolyLine(coords, strokeColor=colors.HexColor(color),
                            strokeWidth=1.25, fillColor=None))
    for i, (name, color, _) in enumerate(series):
        xx = 12 + i * 161
        drawing.add(Line(xx, 231, xx + 14, 231, strokeWidth=2,
                         strokeColor=colors.HexColor(color)))
        drawing.add(String(xx + 19, 228, name, fontName="DejaVu",
                           fontSize=7, fillColor=ink))
    drawing.add(String(left, 9, "NAV diario neto, USD. Sin suavizado ni proyecciones.",
                       fontName="DejaVu", fontSize=7, fillColor=ink))
    return drawing