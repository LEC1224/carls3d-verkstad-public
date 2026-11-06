"""Build the single-sided, actual-size A6 order insert for Carls 3D-verkstad."""

from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"
TARGET = "https://share.google/BoBAlmEXkc16y76rY"
SHORT_URL = "https://carls3d.se/review"
WIDTH, HEIGHT = 105 * mm, 148 * mm
TEAL = colors.HexColor("#005565")
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
BORDER = colors.HexColor("#e5e7eb")
PANEL = colors.HexColor("#f7f9fa")
MARGIN = 8 * mm

PARAGRAPHS = [
    "Tack för att du valt Carls 3D-verkstad! Jag hoppas "
    "utskriften/utskrifterna uppfyller dina förväntningar.",
    "Oavsett vad du tyckte om min tjänst är jag tacksam om du går in och "
    "ger Carls 3D-verkstad en recension på Google. Om betyget är bra blir "
    "jag såklart glad och om betyget är dåligt får jag veta vad jag kan "
    "förbättra, och det hjälper framtida kunder att välja rätt tjänst.",
    "Tack, och lycka till med dina nya prylar!",
]


def register_fonts():
    fonts = Path("C:/Windows/Fonts")
    for name, filename in [
        ("Card", "segoeui.ttf"),
        ("Card-Semibold", "seguisb.ttf"),
        ("Card-Bold", "segoeuib.ttf"),
    ]:
        path = fonts / filename
        if not path.exists() and name == "Card-Semibold":
            path = fonts / "segoeuib.ttf"
        pdfmetrics.registerFont(TTFont(name, str(path)))


def create_card():
    register_fonts()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT / "carls3d-tackkort-a6.pdf"
    pdf = canvas.Canvas(str(destination), pagesize=(WIDTH, HEIGHT), pageCompression=1)
    pdf.setTitle("Carls 3D-verkstad - tackkort A6")
    pdf.setAuthor("Carl M / Carls 3D-verkstad")
    pdf.setSubject("Tackkort för beställningar med QR-kod till Google")

    pdf.setFillColor(colors.white)
    pdf.rect(0, 0, WIDTH, HEIGHT, stroke=0, fill=1)

    # The site's own logo, system typography, dark text and understated borders.
    pdf.drawImage(
        str(ROOT / "public" / "logo.png"),
        MARGIN,
        132 * mm,
        width=10.5 * mm,
        height=10.5 * mm,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    pdf.setFillColor(INK)
    pdf.setFont("Card-Semibold", 11.4)
    pdf.drawString(22 * mm, 138.6 * mm, "Carls 3D-verkstad")
    pdf.setFillColor(MUTED)
    pdf.setFont("Card", 7.7)
    pdf.drawString(22 * mm, 133.6 * mm, "3D-utskrifter på beställning")
    pdf.setStrokeColor(BORDER)
    pdf.setLineWidth(0.55)
    pdf.line(MARGIN, 126.5 * mm, WIDTH - MARGIN, 126.5 * mm)

    pdf.setFillColor(TEAL)
    pdf.setFont("Card-Bold", 28)
    pdf.drawString(MARGIN - 0.3 * mm, 115 * mm, "Hej!")

    body_style = ParagraphStyle(
        "Body",
        fontName="Card",
        fontSize=11.1,
        leading=15.2,
        textColor=INK,
        splitLongWords=False,
        allowWidows=False,
        allowOrphans=False,
    )
    text_width = WIDTH - 2 * MARGIN
    cursor = 108.5 * mm
    layout = []
    for text in PARAGRAPHS:
        paragraph = Paragraph(text, body_style)
        _, height = paragraph.wrap(text_width, HEIGHT)
        paragraph.drawOn(pdf, MARGIN, cursor - height)
        layout.append({"lines": round(height / body_style.leading), "height_mm": round(height / mm, 2)})
        cursor -= height + 3.1 * mm

    signature_y = cursor - 1.2 * mm
    pdf.setFillColor(TEAL)
    pdf.setFont("Card-Semibold", 10.4)
    pdf.drawString(MARGIN, signature_y, "//Carl M")

    panel_x, panel_y = MARGIN, 7 * mm
    panel_width, panel_height = WIDTH - 2 * MARGIN, 27 * mm
    panel_top = panel_y + panel_height
    if signature_y < panel_top + 4 * mm:
        raise ValueError(f"Signature too close to QR panel: {signature_y / mm:.2f} mm")

    pdf.setFillColor(PANEL)
    pdf.setStrokeColor(BORDER)
    pdf.setLineWidth(0.55)
    pdf.roundRect(panel_x, panel_y, panel_width, panel_height, 3.4 * mm, stroke=1, fill=1)

    label_x = panel_x + 4.2 * mm
    pdf.setFillColor(INK)
    pdf.setFont("Card-Semibold", 10.1)
    pdf.drawString(label_x, 26 * mm, "Lämna gärna en recension")
    pdf.setFillColor(MUTED)
    pdf.setFont("Card", 7.7)
    pdf.drawString(label_x, 20.7 * mm, "Skanna QR-koden eller besök")
    pdf.setFillColor(TEAL)
    pdf.setFont("Card-Semibold", 11.5)
    pdf.drawString(label_x, 14 * mm, "carls3d.se/review")
    pdf.linkURL(SHORT_URL, (label_x, 12.8 * mm, 65 * mm, 18 * mm), relative=0, thickness=0)

    # A true vector QR with a four-module white quiet zone, ready for printing.
    qr_size = 25 * mm
    qr_x, qr_y = WIDTH - MARGIN - qr_size - 1.6 * mm, panel_y + 1 * mm
    pdf.setFillColor(colors.white)
    pdf.roundRect(qr_x, qr_y, qr_size, qr_size, 1.5 * mm, stroke=0, fill=1)
    qr = QrCodeWidget(TARGET, barLevel="M", barBorder=4, barFillColor=colors.black)
    x0, y0, x1, y1 = qr.getBounds()
    qr_width, qr_height = x1 - x0, y1 - y0
    drawing = Drawing(
        qr_size,
        qr_size,
        transform=[qr_size / qr_width, 0, 0, qr_size / qr_height, -x0 * qr_size / qr_width, -y0 * qr_size / qr_height],
    )
    drawing.add(qr)
    renderPDF.draw(drawing, pdf, qr_x, qr_y)
    pdf.linkURL(TARGET, (qr_x, qr_y, qr_x + qr_size, qr_y + qr_size), relative=0, thickness=0)

    pdf.showPage()
    pdf.save()
    print({"pdf": str(destination), "page_mm": [105, 148], "paragraphs": layout, "signature_y_mm": round(signature_y / mm, 2), "qr_mm": 25, "qr_target": TARGET})


if __name__ == "__main__":
    create_card()
