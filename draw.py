#!/usr/bin/env python3
"""Render entry.png: a newspaper-style summary of Wednesday 25 November 2026.

Runs at build time with PIL only. No network, no downloaded pictures, no
randomness, no clock reads, so re-running it writes identical bytes.
main.ts (the graded entrypoint) only copies the finished PNG to /output.

The six stories below were checked against the morning wires of 25 Nov 2026:
  * A Houthi drone hits the tallest tower in Riyadh's financial district;
    Saudi civil defence says 11 people were hurt (two Saudis, nine
    foreigners). The Houthis also press toward Aden, 60 km away.
  * A Brooklyn jury convicts Huawei on 10 of 12 counts: trade-secret
    theft, bank fraud, wire fraud, sanctions violations and money
    laundering over Iran and North Korea business; acquitted of
    racketeering and obstruction. Sentencing set for 14 September 2027.
  * Hackers breach an unclassified open-source intelligence system used
    by the CIA and the Office of the Director of National Intelligence;
    officials say no classified information was affected.
  * Zelenskiy confirms Ukraine's drone strike on a Russian cargo ship in
    the Gulf of Finland; Norway urges caution, and Putin says retaliation
    is inevitable after Ukrainian strikes on Russian oil plants.
  * The WHO evacuates staff from a hospital in Akwe, Ituri province,
    DR Congo, after three days sheltering from fighting; the Ebola
    outbreak there has killed 5,775 of 11,762 cases.
  * NATO deploys early-warning aircraft to Poland after Russian missiles
    land in the country during an attack on Ukraine.
The side panel carries four more items from the same morning wires.
"""
from PIL import Image, ImageDraw, ImageFont

CANVAS_W, CANVAS_H = 1024, 1024

PALETTE = {
    "navy": (13, 27, 46),
    "navy_soft": (19, 38, 61),
    "cream": (246, 238, 222),
    "paper": (252, 248, 238),
    "ink": (16, 28, 44),
    "body": (52, 60, 72),
    "red": (198, 44, 34),
    "gold": (214, 158, 46),
    "teal": (18, 128, 122),
    "blue": (38, 96, 158),
    "rust": (186, 84, 32),
    "plum": (110, 72, 150),
    "grey": (160, 168, 182),
    "rule": (58, 74, 96),
}

BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
PLAIN_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def bold(size):
    return ImageFont.truetype(BOLD_PATH, size)


def plain(size):
    return ImageFont.truetype(PLAIN_PATH, size)


def fit_words(canvas, text, font, width):
    """Split text into lines that fit `width` pixels."""
    lines, current = [], ""
    for word in text.split():
        trial = (current + " " + word).strip()
        if canvas.textlength(trial, font=font) <= width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_para(canvas, x, y, text, font, width, colour, leading=None):
    """Draw a wrapped paragraph; return the y just below it."""
    step = leading or int(font.size * 1.28)
    for line in fit_words(canvas, text, font, width):
        canvas.text((x, y), line, font=font, fill=colour)
        y += step
    return y


# ---- small pictograms, drawn with primitives -----------------------------

def icon_ship(canvas, cx, cy, scale, colour):
    canvas.polygon(
        [(cx - 34 * scale, cy), (cx + 34 * scale, cy),
         (cx + 24 * scale, cy + 14 * scale),
         (cx - 24 * scale, cy + 14 * scale)], fill=colour)
    canvas.rectangle([cx - 8 * scale, cy - 16 * scale,
                      cx + 8 * scale, cy], fill=colour)
    canvas.line([cx + 2 * scale, cy - 30 * scale,
                 cx + 2 * scale, cy - 14 * scale], fill=colour, width=4)
    canvas.line([cx - 40 * scale, cy + 24 * scale,
                 cx + 40 * scale, cy + 24 * scale], fill=colour, width=4)
    canvas.line([cx - 28 * scale, cy + 32 * scale,
                 cx + 28 * scale, cy + 32 * scale], fill=colour, width=3)


def icon_tower(canvas, cx, cy, scale, colour):
    # A tall tower with a small flame at its crown.
    canvas.polygon(
        [(cx - 16 * scale, cy + 34 * scale), (cx - 10 * scale, cy - 26 * scale),
         (cx + 10 * scale, cy - 26 * scale), (cx + 16 * scale, cy + 34 * scale)],
        fill=colour)
    for wy in (-14, -2, 10, 22):
        canvas.rectangle([cx - 6 * scale, cy + wy * scale,
                          cx + 6 * scale, cy + (wy + 6) * scale],
                         fill=PALETTE["paper"])
    canvas.polygon(
        [(cx, cy - 44 * scale), (cx + 9 * scale, cy - 26 * scale),
         (cx, cy - 18 * scale), (cx - 9 * scale, cy - 26 * scale)],
        fill=PALETTE["gold"])


def icon_doc(canvas, cx, cy, scale, colour):
    # A legal document: page outline with folded corner and text lines.
    canvas.rounded_rectangle(
        [cx - 18 * scale, cy - 26 * scale, cx + 18 * scale, cy + 26 * scale],
        radius=int(4 * scale), outline=colour, width=4)
    canvas.polygon([(cx + 18 * scale, cy - 26 * scale),
                    (cx + 6 * scale, cy - 26 * scale),
                    (cx + 18 * scale, cy - 14 * scale)], fill=colour)
    for wy in (-10, 0, 10):
        canvas.line([cx - 11 * scale, cy + wy * scale,
                     cx + 11 * scale, cy + wy * scale], fill=colour, width=3)


def icon_lock(canvas, cx, cy, scale, colour):
    canvas.arc([cx - 16 * scale, cy - 26 * scale, cx + 16 * scale, cy + 6 * scale],
               start=180, end=360, fill=colour, width=5)
    canvas.rounded_rectangle(
        [cx - 22 * scale, cy - 6 * scale, cx + 22 * scale, cy + 30 * scale],
        radius=int(5 * scale), fill=colour)
    canvas.ellipse([cx - 4 * scale, cy + 4 * scale,
                    cx + 4 * scale, cy + 12 * scale], fill=PALETTE["paper"])
    canvas.line([cx, cy + 10 * scale, cx, cy + 20 * scale],
                fill=PALETTE["paper"], width=3)


def icon_cross(canvas, cx, cy, scale, colour):
    canvas.rectangle([cx - 8 * scale, cy - 28 * scale,
                      cx + 8 * scale, cy + 28 * scale], fill=colour)
    canvas.rectangle([cx - 28 * scale, cy - 8 * scale,
                      cx + 28 * scale, cy + 8 * scale], fill=colour)


def icon_radar(canvas, cx, cy, radius, colour):
    canvas.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                   outline=colour, width=4)
    half = radius // 2
    canvas.ellipse([cx - half, cy - half, cx + half, cy + half],
                   outline=colour, width=3)
    canvas.line([cx, cy, cx + int(radius * 0.7),
                 cy - int(radius * 0.7)], fill=colour, width=4)
    canvas.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=colour)


ICONS = {
    "tower": lambda c, x, y: icon_tower(c, x + 20, y + 20, 0.9, PALETTE["red"]),
    "doc": lambda c, x, y: icon_doc(c, x + 20, y + 20, 0.95, PALETTE["rust"]),
    "lock": lambda c, x, y: icon_lock(c, x + 20, y + 20, 0.95, PALETTE["blue"]),
    "ship": lambda c, x, y: icon_ship(c, x + 20, y + 20, 0.55, PALETTE["teal"]),
    "cross": lambda c, x, y: icon_cross(c, x + 20, y + 20, 0.8, PALETTE["red"]),
    "radar": lambda c, x, y: icon_radar(c, x + 20, y + 20, 18,
                                        PALETTE["plum"]),
}

LEAD = {
    "kicker": "WAR  \u00b7  YEMEN / SAUDI ARABIA",
    "accent": "red",
    "headline": "Houthis strike Riyadh's tallest tower",
    "body": ("A drone hits a tower in Riyadh's financial district; "
             "11 people hurt, two Saudis and nine foreigners."),
}

STORIES = [
    {"kicker": "COURTS \u00b7 USA / CHINA", "accent": "rust",
     "headline": "Huawei guilty on 10 of 12 counts",
     "body": ("Brooklyn jury convicts on trade-secret theft, bank "
              "fraud and Iran sanctions."),
     "icon": "doc"},
    {"kicker": "CYBER \u00b7 USA", "accent": "blue",
     "headline": "CIA, spy chief's office breached",
     "body": ("Hackers hit an unclassified intel system; officials "
              "say no classified data was touched."),
     "icon": "lock"},
    {"kicker": "WAR \u00b7 UKRAINE", "accent": "teal",
     "headline": "Kyiv owns ship strike",
     "body": ("Zelenskiy confirms the Gulf of Finland drone hit; "
              "Putin vows payback."),
     "icon": "ship"},
    {"kicker": "HEALTH \u00b7 CONGO", "accent": "red",
     "headline": "WHO flees Ebola hospital",
     "body": ("Staff leave Akwe hospital after three days; "
              "5,775 dead so far."),
     "icon": "cross"},
    {"kicker": "EUROPE \u00b7 NATO", "accent": "plum",
     "headline": "NATO jets head to Poland",
     "body": ("Early-warning aircraft deploy after Russian missiles "
              "land in Poland."),
     "icon": "radar"},
]

ALSO_TODAY = [
    "Three tankers mined in Hormuz, Iran says.",
    "EU announces fresh sanctions on Russia.",
    "BJP, Akali Dal reunite for Punjab polls.",
    "Anthropic slides below $83 IPO price.",
]


def story_card(canvas, x, y, width, height, story):
    """One paper card: coloured top strip, icon + kicker, headline, body."""
    accent = PALETTE[story["accent"]]
    canvas.rounded_rectangle([x, y, x + width, y + height], radius=12,
                             fill=PALETTE["paper"])
    canvas.rounded_rectangle([x, y, x + width, y + 7], radius=3, fill=accent)
    ix, iy = x + 18, y + 22
    ICONS[story["icon"]](canvas, ix, iy)
    canvas.text((ix + 50, iy + 8), story["kicker"], font=bold(17),
                fill=accent)
    below_headline = draw_para(canvas, x + 18, y + 72, story["headline"],
                               bold(26), width - 36, PALETTE["ink"])
    draw_para(canvas, x + 18, below_headline + 6, story["body"], plain(20),
              width - 36, PALETTE["body"])


def also_panel(canvas, x, y, width, height):
    """The dark 'also today' panel in the last grid slot."""
    canvas.rounded_rectangle([x, y, x + width, y + height], radius=12,
                             fill=PALETTE["navy_soft"])
    canvas.rounded_rectangle([x, y, x + width, y + 7], radius=3,
                             fill=PALETTE["gold"])
    canvas.text((x + 18, y + 20), "ALSO TODAY", font=bold(22),
                fill=PALETTE["gold"])
    yy = y + 52
    for item in ALSO_TODAY:
        canvas.ellipse([x + 20, yy + 7, x + 28, yy + 15],
                       fill=PALETTE["gold"])
        yy = draw_para(canvas, x + 38, yy, item, plain(18), width - 56,
                       PALETTE["cream"], leading=21) + 5


def build():
    image = Image.new("RGB", (CANVAS_W, CANVAS_H), PALETTE["navy"])
    canvas = ImageDraw.Draw(image)

    # Masthead: title, date, standfirst, red rule.
    canvas.text((48, 22), "THE WORLD IN ONE DAY", font=bold(62),
                fill=PALETTE["cream"])
    canvas.text((48, 94), "WEDNESDAY  \u00b7  25 NOVEMBER 2026", font=bold(38),
                fill=PALETTE["gold"])
    canvas.text((48, 140),
                "Six stories that defined the day, from Riyadh to Brooklyn",
                font=plain(24), fill=PALETTE["grey"])
    canvas.rectangle([48, 176, 976, 182], fill=PALETTE["red"])

    # Lead story: full-width card with a tower pictogram.
    lx, ly, lw, lh = 48, 188, 928, 208
    canvas.rounded_rectangle([lx, ly, lx + lw, ly + lh], radius=12,
                             fill=PALETTE["paper"])
    canvas.rectangle([lx, ly + 12, lx + 8, ly + lh - 12],
                     fill=PALETTE["red"])
    icon_tower(canvas, lx + 84, ly + lh // 2, 1.0, PALETTE["red"])
    tx = lx + 168
    canvas.text((tx, ly + 16), LEAD["kicker"], font=bold(20),
                fill=PALETTE["red"])
    below = draw_para(canvas, tx, ly + 46, LEAD["headline"], bold(40),
                      lw - 200, PALETTE["ink"], leading=46)
    draw_para(canvas, tx, below + 6, LEAD["body"], plain(24), lw - 200,
              PALETTE["body"], leading=28)

    # Grid: five story cards, then the also-today panel.
    card_w, card_h, gap = 296, 246, 20
    cols = [48, 48 + card_w + gap, 48 + 2 * (card_w + gap)]
    rows = [410, 410 + card_h + 16]
    slots = [(c, r) for r in rows for c in cols]
    for story, (sx, sy) in zip(STORIES, slots):
        story_card(canvas, sx, sy, card_w, card_h, story)
    also_panel(canvas, *slots[len(STORIES)], card_w, card_h)

    # Footer.
    canvas.line([48, 932, 976, 932], fill=PALETTE["rule"], width=2)
    canvas.text(
        (48, 946),
        "Drawn from reports published on 25 November 2026  \u00b7  "
        "One day, one image",
        font=plain(20), fill=PALETTE["grey"])

    image.save("entry.png", optimize=True)
    print("saved entry.png")


if __name__ == "__main__":
    build()
