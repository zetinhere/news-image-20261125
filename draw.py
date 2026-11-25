#!/usr/bin/env python3
"""Draw the 25 November 2026 world-news front page as a 1024x1024 PNG.

Everything is drawn with PIL primitives: text, rectangles, ellipses and
polygons. No network, no downloaded assets, no image files read in, so the
same run always writes the same bytes.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
MARGIN = 48
CONTENT_W = SIZE - 2 * MARGIN

# --- palette ---------------------------------------------------------------
BG = (13, 27, 46)          # deep navy page
PANEL = (21, 42, 68)       # dark panel behind ALSO TODAY
CARD = (250, 244, 232)     # warm cream cards
INK = (18, 35, 58)         # near-black navy headlines
BODY = (60, 74, 92)        # slate body copy
MUTED = (139, 160, 181)    # grey-blue captions
GOLD = (233, 161, 59)      # date line, ALSO TODAY heading, bullets
RED = (194, 59, 46)        # masthead rule, lead kicker and bar
RULE = (42, 59, 82)        # hairline above the footer

ACCENT_ORANGE = (217, 123, 41)
ACCENT_BLUE = (46, 111, 183)
ACCENT_TEAL = (31, 138, 122)
ACCENT_PURPLE = (122, 79, 163)

# --- fonts -----------------------------------------------------------------
FONT_DIRS = ("/usr/share/fonts/truetype/liberation",
             "/usr/share/fonts/truetype/noto",
             "/usr/share/fonts/truetype/dejavu")


def load_font(bold, size):
    """Find a plain sans font; prefer Liberation, then Noto, then DejaVu."""
    names = ("LiberationSans-Bold.ttf", "NotoSans-Bold.ttf",
             "DejaVuSans-Bold.ttf") if bold else (
        "LiberationSans-Regular.ttf", "NotoSans-Regular.ttf",
        "DejaVuSans.ttf")
    for folder in FONT_DIRS:
        for name in names:
            path = Path(folder) / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def fit_font(draw, text, bold, start_size, width, min_size=15):
    """Largest bold font at or below start_size that fits width."""
    size = start_size
    while size > min_size:
        font = load_font(bold, size)
        if draw.textlength(text, font=font) <= width:
            return font
        size -= 1
    return load_font(bold, min_size)


class Fonts:
    def __init__(self):
        self.masthead = load_font(True, 58)
        self.dateline = load_font(True, 36)
        self.subtitle = load_font(False, 22)
        self.kicker = load_font(True, 20)
        self.lead_head = load_font(True, 40)
        self.lead_body = load_font(False, 22)
        self.head = load_font(True, 26)
        self.body = load_font(False, 19)
        self.panel_head = load_font(True, 25)
        self.panel_item = load_font(False, 18)
        self.footer = load_font(False, 20)


# --- text helpers ----------------------------------------------------------
def wrap(draw, text, font, width):
    """Greedy word wrap; returns a list of lines that fit inside width."""
    lines, current = [], ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def text_block(draw, xy, lines, font, fill, leading):
    """Draw lines top-down; returns the y just below the last line."""
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += leading
    return y


def fit_lines(draw, text, font, width, limit):
    """Wrap text and clip to at most `limit` lines, ellipsising the last."""
    lines = wrap(draw, text, font, width)
    if len(lines) <= limit:
        return lines
    lines = lines[:limit]
    while lines and draw.textlength(lines[-1] + " …", font=font) > width:
        lines[-1] = lines[-1].rsplit(" ", 1)[0]
    lines[-1] += " …"
    return lines


# --- little pictograms, drawn from shapes ----------------------------------
def icon_tower(d, x, y, w, h, color=None):
    """A stepped tower with a gold spire: the Riyadh lead image."""
    d.polygon([(x + w / 2, y), (x + w * 0.62, y + h * 0.16),
               (x + w * 0.38, y + h * 0.16)], fill=GOLD)
    top = y + h * 0.16
    d.rectangle([x + w * 0.30, top, x + w * 0.70, y + h * 0.48], fill=RED)
    d.rectangle([x + w * 0.22, y + h * 0.48, x + w * 0.78, y + h * 0.76],
                fill=(214, 74, 54))
    d.rectangle([x + w * 0.14, y + h * 0.76, x + w * 0.86, y + h], fill=RED)
    for row, yy in enumerate((0.24, 0.36, 0.56, 0.66, 0.84, 0.93)):
        inset = 0.36 if row < 2 else (0.28 if row < 4 else 0.20)
        d.rectangle([x + w * inset, y + h * yy, x + w * (1 - inset),
                     y + h * yy + 4], fill=(250, 244, 232))


def icon_document(d, x, y, w, h, color):
    """A sheet of paper with a folded corner and three text lines."""
    d.rounded_rectangle([x, y, x + w, y + h], radius=4, outline=color, width=4)
    d.polygon([(x + w * 0.62, y), (x + w, y + h * 0.30),
               (x + w * 0.62, y + h * 0.30)], fill=color)
    for i, yy in enumerate((0.42, 0.58, 0.74)):
        d.line([x + w * 0.18, y + h * yy, x + w * (0.82 if i < 2 else 0.60),
                y + h * yy], fill=color, width=4)


def icon_lock(d, x, y, w, h, color):
    """A padlock: shackle arc, body, keyhole."""
    d.arc([x + w * 0.24, y, x + w * 0.76, y + h * 0.52], start=180, end=360,
          fill=color, width=6)
    d.rounded_rectangle([x + w * 0.10, y + h * 0.42, x + w * 0.90, y + h],
                        radius=6, fill=color)
    d.ellipse([x + w * 0.43, y + h * 0.54, x + w * 0.57, y + h * 0.68],
              fill=(250, 244, 232))
    d.rectangle([x + w * 0.47, y + h * 0.64, x + w * 0.53, y + h * 0.84],
                fill=(250, 244, 232))


def icon_ship(d, x, y, w, h, color):
    """A cargo ship seen side-on: hull, deck boxes, mast."""
    d.polygon([(x, y + h * 0.62), (x + w, y + h * 0.62),
               (x + w * 0.88, y + h), (x + w * 0.12, y + h)], fill=color)
    d.rectangle([x + w * 0.18, y + h * 0.34, x + w * 0.40, y + h * 0.62],
                fill=color)
    d.rectangle([x + w * 0.46, y + h * 0.34, x + w * 0.66, y + h * 0.62],
                fill=color)
    d.line([x + w * 0.76, y + h * 0.10, x + w * 0.76, y + h * 0.62],
           fill=color, width=5)
    d.line([x + w * 0.76, y + h * 0.10, x + w * 0.94, y + h * 0.22],
           fill=color, width=4)


def icon_cross(d, x, y, w, h, color):
    """A bold medical cross."""
    d.rectangle([x + w * 0.36, y, x + w * 0.64, y + h], fill=color)
    d.rectangle([x, y + h * 0.36, x + w, y + h * 0.64], fill=color)


def icon_target(d, x, y, w, h, color):
    """Concentric rings with a centre dot: early-warning radar."""
    cx, cy = x + w / 2, y + h / 2
    for r in (w * 0.48, w * 0.32, w * 0.16):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=5)
    d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=color)


ICONS = {
    "tower": icon_tower,
    "document": icon_document,
    "lock": icon_lock,
    "ship": icon_ship,
    "cross": icon_cross,
    "target": icon_target,
}


# --- the stories -----------------------------------------------------------
LEAD = {
    "icon": "tower",
    "accent": RED,
    "kicker": "WAR  ·  YEMEN / SAUDI ARABIA",
    "headline": "Houthis strike Riyadh's tallest tower",
    "body": "A drone hits a tower in Riyadh's financial district; 11 people "
            "hurt, two Saudis and nine foreigners.",
}

CARDS = [
    {
        "icon": "document", "accent": ACCENT_ORANGE,
        "kicker": "COURTS  ·  USA / CHINA",
        "headline": "Huawei guilty on 10 of 12 counts",
        "body": "Brooklyn jury convicts on trade-secret theft, bank fraud "
                "and Iran sanctions.",
    },
    {
        "icon": "lock", "accent": ACCENT_BLUE,
        "kicker": "CYBER  ·  USA",
        "headline": "CIA, spy chief's office breached",
        "body": "Hackers hit an unclassified intel system; no classified "
                "data was touched.",
    },
    {
        "icon": "ship", "accent": ACCENT_TEAL,
        "kicker": "WAR  ·  UKRAINE",
        "headline": "Kyiv owns ship strike",
        "body": "Zelenskiy confirms the Gulf of Finland drone hit; Putin "
                "vows payback.",
    },
    {
        "icon": "cross", "accent": RED,
        "kicker": "HEALTH  ·  CONGO",
        "headline": "WHO flees Ebola hospital",
        "body": "Staff leave Akwe hospital after three days; 5,775 dead so "
                "far.",
    },
    {
        "icon": "target", "accent": ACCENT_PURPLE,
        "kicker": "EUROPE  ·  NATO",
        "headline": "NATO jets head to Poland",
        "body": "Early-warning aircraft deploy after Russian missiles land "
                "in Poland.",
    },
]

ALSO_TODAY = [
    "Three tankers mined in Hormuz, Iran says.",
    "EU announces fresh sanctions on Russia.",
    "BJP, Akali Dal reunite for Punjab polls.",
    "Anthropic slides below $83 IPO price.",
]


# --- layout ----------------------------------------------------------------
def draw_masthead(d, f):
    d.text((MARGIN, 40), "THE WORLD IN ONE DAY", font=f.masthead, fill=CARD)
    d.text((MARGIN, 108), "WEDNESDAY  ·  25 NOVEMBER 2026",
           font=f.dateline, fill=GOLD)
    d.text((MARGIN, 158), "Six stories that defined the day, from Riyadh to Brooklyn",
           font=f.subtitle, fill=MUTED)
    d.rectangle([MARGIN, 192, MARGIN + CONTENT_W, 198], fill=RED)


def draw_lead(d, f, box):
    x, y, w, h = box
    d.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=CARD)
    d.rounded_rectangle([x, y, x + 10, y + h], radius=5, fill=RED)
    ICONS[LEAD["icon"]](d, x + 34, y + 34, 64, h - 68)
    tx = x + 128
    d.text((tx, y + 16), LEAD["kicker"], font=f.kicker, fill=RED)
    head = fit_lines(d, LEAD["headline"], f.lead_head, w - 128 - 28, 2)
    y2 = text_block(d, (tx, y + 44), head, f.lead_head, INK, 45)
    body = fit_lines(d, LEAD["body"], f.lead_body, w - 128 - 28, 2)
    text_block(d, (tx, y2 + 8), body, f.lead_body, BODY, 26)


def draw_card(d, f, box, story):
    x, y, w, h = box
    accent = story["accent"]
    d.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=CARD)
    d.rounded_rectangle([x, y, x + w, y + 9], radius=4, fill=accent)
    d.rectangle([x, y + 5, x + w, y + 9], fill=accent)
    ICONS[story["icon"]](d, x + 20, y + 24, 40, 40, accent)
    kicker_font = fit_font(d, story["kicker"], True, 20, w - 88)
    d.text((x + 68, y + 30), story["kicker"], font=kicker_font, fill=accent)
    head = fit_lines(d, story["headline"], f.head, w - 40, 2)
    y2 = text_block(d, (x + 20, y + 78), head, f.head, INK, 31)
    body = fit_lines(d, story["body"], f.body, w - 40, 3)
    text_block(d, (x + 20, y2 + 8), body, f.body, BODY, 23)


def draw_also_today(d, f, box):
    x, y, w, h = box
    d.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=PANEL)
    d.rounded_rectangle([x, y, x + w, y + 9], radius=4, fill=GOLD)
    d.rectangle([x, y + 5, x + w, y + 9], fill=GOLD)
    d.text((x + 20, y + 18), "ALSO TODAY", font=f.panel_head, fill=GOLD)
    cy = y + 52
    for item in ALSO_TODAY:
        lines = fit_lines(d, item, f.panel_item, w - 56, 2)
        d.ellipse([x + 22, cy + 7, x + 30, cy + 15], fill=GOLD)
        cy = text_block(d, (x + 42, cy), lines, f.panel_item, CARD, 22)
        cy += 4


def draw_footer(d, f):
    d.line([MARGIN, 928, MARGIN + CONTENT_W, 928], fill=RULE, width=2)
    d.text((MARGIN, 944),
           "Drawn from reports published on 25 November 2026  ·  One day, one image",
           font=f.footer, fill=MUTED)


def render(path):
    img = Image.new("RGB", (SIZE, SIZE), BG)
    d = ImageDraw.Draw(img)
    f = Fonts()
    draw_masthead(d, f)

    col_w = (CONTENT_W - 2 * 16) // 3
    xs = [MARGIN, MARGIN + col_w + 16, MARGIN + 2 * (col_w + 16)]
    draw_lead(d, f, (MARGIN, 206, CONTENT_W, 200))
    for i, story in enumerate(CARDS[:3]):
        draw_card(d, f, (xs[i], 422, col_w, 220), story)
    for i, story in enumerate(CARDS[3:]):
        draw_card(d, f, (xs[i], 658, col_w, 256), story)
    draw_also_today(d, f, (xs[2], 658, col_w, 256))
    draw_footer(d, f)

    img.save(path, format="PNG")
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "entry.png"
    render(out)
    print(f"wrote {out}")
