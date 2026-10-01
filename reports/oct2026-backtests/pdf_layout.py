"""Reusable PDF layout helpers for the October 2026 backtest comparison."""
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    KeepTogether,
)

ROOT = Path(__file__).parent
NAVY = colors.HexColor("#1E3158")
TEAL = colors.HexColor("#3C7686")
INK = colors.HexColor("#253448")
MUTED = colors.HexColor("#59687B")
LIGHT = colors.HexColor("#F0F4F8")
RED = colors.HexColor("#973130")
FONT = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("DejaVu", str(FONT / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DejaVuBold", str(FONT / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFontFamily("DejaVu", normal="DejaVu", bold="DejaVuBold")

STYLES = {
    "title": ParagraphStyle("ReportTitle", fontName="DejaVuBold", fontSize=25,
                            leading=31, textColor=NAVY, spaceAfter=16),
    "subtitle": ParagraphStyle("Subtitle", fontName="DejaVu", fontSize=12,
                               leading=18, textColor=MUTED, spaceAfter=14),
    "h1": ParagraphStyle("Section", fontName="DejaVuBold", fontSize=15,
                         leading=21, textColor=NAVY, spaceBefore=14,
                         spaceAfter=10, keepWithNext=True),
    "h2": ParagraphStyle("Subsection", fontName="DejaVuBold", fontSize=10,
                         leading=15, textColor=TEAL, spaceBefore=10,
                         spaceAfter=6, keepWithNext=True),
    "body": ParagraphStyle("Body", fontName="DejaVu", fontSize=9,
                           leading=14, textColor=INK, spaceAfter=9),
    "small": ParagraphStyle("Small", fontName="DejaVu", fontSize=7.4,
                            leading=10.5, textColor=MUTED, spaceAfter=6),
    "cell": ParagraphStyle("Cell", fontName="DejaVu", fontSize=8,
                           leading=11, textColor=INK),
    "header": ParagraphStyle("Header", fontName="DejaVuBold", fontSize=8,
                             leading=11, textColor=colors.white),
}


def p(text, style="body"):
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), STYLES[style])


def pct(value, digits=2):
    return "N/D" if value is None else f"{value * 100:,.{digits}f}%"


def usd(value):
    return "N/D" if value is None else f"USD {value:,.2f}"


def number(value, digits=2):
    return "N/D" if value is None else f"{value:,.{digits}f}"


def table(headers, rows, widths=None):
    content = [[p(x, "header") for x in headers]]
    content += [[p("" if x is None else x, "cell") for x in row] for row in rows]
    out = Table(content, colWidths=widths, repeatRows=1, hAlign="LEFT")
    out.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, NAVY),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.HexColor("#CAD4DF")),
    ]))
    return out


def notice(text):
    out = Table([[p(text)]], colWidths=[491])
    out.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.7, TEAL),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return out


def page_frame(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, h - 12, w, 12, fill=1, stroke=0)
    canvas.setFont("DejaVu", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(52, 30, "ALLOCATION LAB  |  Investigación cuantitativa  |  Octubre 2026")
    canvas.drawRightString(w - 52, 30, str(doc.page))
    canvas.restoreState()


def build_pdf(story, filename="Comparacion_Backtests_Octubre_2026.pdf"):
    output = ROOT / filename
    doc = SimpleDocTemplate(
        str(output), pagesize=A4, rightMargin=52, leftMargin=52,
        topMargin=42, bottomMargin=52, title="Tres estrategias — Octubre 2026",
        author="Allocation Lab", subject="Backtests y asignaciones del modelo",
    )
    doc.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    return output