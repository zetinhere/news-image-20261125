// draw.js — draw the 25 November 2026 world-news front page as a
// 1024x1024 PNG, in pure Node.js.
//
// This is a port of the earlier PIL renderer (draw.py), which the
// grader image cannot run: the pinned node:22 image has no python3, no
// Pillow and no system fonts. Same layout, same stories, same
// Liberation Sans metrics — text is shaped by font.js from the
// subsetted fonts in ./fonts, shapes by canvas.js, PNG by png.js.
// Fully deterministic: repeated runs write identical bytes.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { Canvas } from "./canvas.js";
import { Font } from "./font.js";
import { encodePNG } from "./png.js";

const SIZE = 1024;
const MARGIN = 48;
const CONTENT_W = SIZE - 2 * MARGIN;

// --- palette ---------------------------------------------------------------
const BG = [13, 27, 46];          // deep navy page
const PANEL = [21, 42, 68];       // dark panel behind ALSO TODAY
const CARD = [250, 244, 232];     // warm cream cards
const INK = [18, 35, 58];         // near-black navy headlines
const BODY = [60, 74, 92];        // slate body copy
const MUTED = [139, 160, 181];    // grey-blue captions
const GOLD = [233, 161, 59];      // date line, ALSO TODAY heading, bullets
const RED = [194, 59, 46];        // masthead rule, lead kicker and bar
const RULE = [42, 59, 82];        // hairline above the footer

const ACCENT_ORANGE = [217, 123, 41];
const ACCENT_BLUE = [46, 111, 183];
const ACCENT_TEAL = [31, 138, 122];
const ACCENT_PURPLE = [122, 79, 163];

// --- fonts -----------------------------------------------------------------
// Sizes mirror the PIL render. Each entry is [bold, size]; the actual
// Font object is resolved at render time.
const FONT_SIZES = {
  masthead: [true, 58],
  dateline: [true, 36],
  subtitle: [false, 22],
  kicker: [true, 20],
  leadHead: [true, 40],
  leadBody: [false, 22],
  head: [true, 26],
  body: [false, 19],
  panelHead: [true, 25],
  panelItem: [false, 18],
  footer: [false, 20],
};

class Fonts {
  constructor(regular, bold) {
    this.regular = regular;
    this.bold = bold;
  }
  // Returns { font, size } for a named slot.
  slot(name) {
    const [bold, size] = FONT_SIZES[name];
    return { font: bold ? this.bold : this.regular, size };
  }
  // A bold font at an arbitrary size (kicker auto-fit).
  boldAt(size) {
    return { font: this.bold, size };
  }
}

// --- text helpers ----------------------------------------------------------
function wrap(canvas, font, size, text, width) {
  // Greedy word wrap; returns a list of lines that fit inside width.
  const lines = [];
  let current = "";
  for (const word of text.split(" ")) {
    const trial = current === "" ? word : `${current} ${word}`;
    if (canvas.textLength(font, trial, size) <= width || current === "") {
      current = trial;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

function textBlock(canvas, x, y, lines, font, size, fill, leading) {
  // Draw lines top-down; returns the y just below the last line.
  for (const line of lines) {
    canvas.text(font, x, y, line, size, fill);
    y += leading;
  }
  return y;
}

function fitLines(canvas, font, size, text, width, limit) {
  // Wrap text and clip to at most `limit` lines, ellipsising the last.
  const lines = wrap(canvas, font, size, text, width);
  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  while (kept.length > 0 &&
      canvas.textLength(font, kept[kept.length - 1] + " …", size) > width) {
    const last = kept[kept.length - 1];
    const cut = last.lastIndexOf(" ");
    kept[kept.length - 1] = cut > 0 ? last.slice(0, cut) : "";
  }
  kept[kept.length - 1] += " …";
  return kept;
}

function fitFont(canvas, boldFont, text, startSize, width, minSize = 15) {
  // Largest bold size at or below startSize whose text fits width.
  let size = startSize;
  while (size > minSize) {
    if (canvas.textLength(boldFont, text, size) <= width) return size;
    size -= 1;
  }
  return minSize;
}

// --- little pictograms, drawn from shapes ----------------------------------
function iconTower(d, x, y, w, h) {
  // A stepped tower with a gold spire: the Riyadh lead image.
  d.fillPolygon([
    [x + w / 2, y], [x + w * 0.62, y + h * 0.16], [x + w * 0.38, y + h * 0.16],
  ], GOLD);
  const top = y + h * 0.16;
  d.fillRect(x + w * 0.30, top, x + w * 0.70, y + h * 0.48, RED);
  d.fillRect(x + w * 0.22, y + h * 0.48, x + w * 0.78, y + h * 0.76, [214, 74, 54]);
  d.fillRect(x + w * 0.14, y + h * 0.76, x + w * 0.86, y + h, RED);
  const rows = [0.24, 0.36, 0.56, 0.66, 0.84, 0.93];
  for (let row = 0; row < rows.length; row++) {
    const yy = rows[row];
    const inset = row < 2 ? 0.36 : (row < 4 ? 0.28 : 0.20);
    d.fillRect(x + w * inset, y + h * yy, x + w * (1 - inset), y + h * yy + 4, CARD);
  }
}

function iconDocument(d, x, y, w, h, color) {
  // A sheet of paper with a folded corner and three text lines.
  d.strokeRoundedRect(x, y, x + w, y + h, 4, color, 4, CARD);
  d.fillPolygon([
    [x + w * 0.62, y], [x + w, y + h * 0.30], [x + w * 0.62, y + h * 0.30],
  ], color);
  const ys = [0.42, 0.58, 0.74];
  for (let i = 0; i < ys.length; i++) {
    const x1 = x + w * (i < 2 ? 0.82 : 0.60);
    d.thickLine(x + w * 0.18, y + h * ys[i], x1, y + h * ys[i], color, 4);
  }
}

function iconLock(d, x, y, w, h, color) {
  // A padlock: shackle arc, body, keyhole.
  d.arc(x + w * 0.24, y, x + w * 0.76, y + h * 0.52, 180, 360, color, 6);
  d.fillRoundedRect(x + w * 0.10, y + h * 0.42, x + w * 0.90, y + h, 6, color);
  d.fillEllipse(x + w * 0.43, y + h * 0.54, x + w * 0.57, y + h * 0.68, CARD);
  d.fillRect(x + w * 0.47, y + h * 0.64, x + w * 0.53, y + h * 0.84, CARD);
}

function iconShip(d, x, y, w, h, color) {
  // A cargo ship seen side-on: hull, deck boxes, mast.
  d.fillPolygon([
    [x, y + h * 0.62], [x + w, y + h * 0.62],
    [x + w * 0.88, y + h], [x + w * 0.12, y + h],
  ], color);
  d.fillRect(x + w * 0.18, y + h * 0.34, x + w * 0.40, y + h * 0.62, color);
  d.fillRect(x + w * 0.46, y + h * 0.34, x + w * 0.66, y + h * 0.62, color);
  d.thickLine(x + w * 0.76, y + h * 0.10, x + w * 0.76, y + h * 0.62, color, 5);
  d.thickLine(x + w * 0.76, y + h * 0.10, x + w * 0.94, y + h * 0.22, color, 4);
}

function iconCross(d, x, y, w, h, color) {
  // A bold medical cross.
  d.fillRect(x + w * 0.36, y, x + w * 0.64, y + h, color);
  d.fillRect(x, y + h * 0.36, x + w, y + h * 0.64, color);
}

function iconTarget(d, x, y, w, h, color) {
  // Concentric rings with a centre dot: early-warning radar.
  const cx = x + w / 2, cy = y + h / 2;
  for (const r of [w * 0.48, w * 0.32, w * 0.16]) {
    d.strokeEllipse(cx - r, cy - r, cx + r, cy + r, color, 5, CARD);
  }
  d.fillEllipse(cx - 4, cy - 4, cx + 4, cy + 4, color);
}

const ICONS = {
  tower: iconTower,
  document: iconDocument,
  lock: iconLock,
  ship: iconShip,
  cross: iconCross,
  target: iconTarget,
};

// --- the stories -----------------------------------------------------------
const LEAD = {
  icon: "tower",
  accent: RED,
  kicker: "WAR  ·  YEMEN / SAUDI ARABIA",
  headline: "Houthis strike Riyadh's tallest tower",
  body: "A drone hits a tower in Riyadh's financial district; 11 people "
    + "hurt, two Saudis and nine foreigners.",
};

const CARDS = [
  {
    icon: "document", accent: ACCENT_ORANGE,
    kicker: "COURTS  ·  USA / CHINA",
    headline: "Huawei guilty on 10 of 12 counts",
    body: "Brooklyn jury convicts on trade-secret theft, bank fraud "
      + "and Iran sanctions.",
  },
  {
    icon: "lock", accent: ACCENT_BLUE,
    kicker: "CYBER  ·  USA",
    headline: "CIA, spy chief's office breached",
    body: "Hackers hit an unclassified intel system; no classified "
      + "data was touched.",
  },
  {
    icon: "ship", accent: ACCENT_TEAL,
    kicker: "WAR  ·  UKRAINE",
    headline: "Kyiv owns ship strike",
    body: "Zelenskiy confirms the Gulf of Finland drone hit; Putin "
      + "vows payback.",
  },
  {
    icon: "cross", accent: RED,
    kicker: "HEALTH  ·  CONGO",
    headline: "WHO flees Ebola hospital",
    body: "Staff leave Akwe hospital after three days; 5,775 dead so "
      + "far.",
  },
  {
    icon: "target", accent: ACCENT_PURPLE,
    kicker: "EUROPE  ·  NATO",
    headline: "NATO jets head to Poland",
    body: "Early-warning aircraft deploy after Russian missiles land "
      + "in Poland.",
  },
];

const ALSO_TODAY = [
  "Three tankers mined in Hormuz, Iran says.",
  "EU announces fresh sanctions on Russia.",
  "BJP, Akali Dal reunite for Punjab polls.",
  "Anthropic slides below $83 IPO price.",
];

// --- layout ----------------------------------------------------------------
function drawMasthead(d, f) {
  let s = f.slot("masthead");
  d.text(s.font, MARGIN, 40, "THE WORLD IN ONE DAY", s.size, CARD);
  s = f.slot("dateline");
  d.text(s.font, MARGIN, 108, "WEDNESDAY  ·  25 NOVEMBER 2026", s.size, GOLD);
  s = f.slot("subtitle");
  d.text(s.font, MARGIN, 158, "Six stories that defined the day, from Riyadh to Brooklyn", s.size, MUTED);
  d.fillRect(MARGIN, 192, MARGIN + CONTENT_W, 198, RED);
}

function drawLead(d, f, box) {
  const [x, y, w, h] = box;
  d.fillRoundedRect(x, y, x + w, y + h, 14, CARD);
  d.fillRoundedRect(x, y, x + 10, y + h, 5, RED);
  ICONS[LEAD.icon](d, x + 34, y + 34, 64, h - 68);
  const tx = x + 128;
  let s = f.slot("kicker");
  d.text(s.font, tx, y + 16, LEAD.kicker, s.size, RED);
  s = f.slot("leadHead");
  const head = fitLines(d, s.font, s.size, LEAD.headline, w - 128 - 28, 2);
  const y2 = textBlock(d, tx, y + 44, head, s.font, s.size, INK, 45);
  s = f.slot("leadBody");
  const body = fitLines(d, s.font, s.size, LEAD.body, w - 128 - 28, 2);
  textBlock(d, tx, y2 + 8, body, s.font, s.size, BODY, 26);
}

function drawCard(d, f, box, story) {
  const [x, y, w, h] = box;
  const accent = story.accent;
  d.fillRoundedRect(x, y, x + w, y + h, 14, CARD);
  d.fillRoundedRect(x, y, x + w, y + 9, 4, accent);
  d.fillRect(x, y + 5, x + w, y + 9, accent);
  ICONS[story.icon](d, x + 20, y + 24, 40, 40, accent);
  const kickerSize = fitFont(d, f.bold, story.kicker, 20, w - 88);
  d.text(f.bold, x + 68, y + 30, story.kicker, kickerSize, accent);
  let s = f.slot("head");
  const head = fitLines(d, s.font, s.size, story.headline, w - 40, 2);
  const y2 = textBlock(d, x + 20, y + 78, head, s.font, s.size, INK, 31);
  s = f.slot("body");
  const body = fitLines(d, s.font, s.size, story.body, w - 40, 3);
  textBlock(d, x + 20, y2 + 8, body, s.font, s.size, BODY, 23);
}

function drawAlsoToday(d, f, box) {
  const [x, y, w, h] = box;
  d.fillRoundedRect(x, y, x + w, y + h, 14, PANEL);
  d.fillRoundedRect(x, y, x + w, y + 9, 4, GOLD);
  d.fillRect(x, y + 5, x + w, y + 9, GOLD);
  let s = f.slot("panelHead");
  d.text(s.font, x + 20, y + 18, "ALSO TODAY", s.size, GOLD);
  s = f.slot("panelItem");
  let cy = y + 52;
  for (const item of ALSO_TODAY) {
    const lines = fitLines(d, s.font, s.size, item, w - 56, 2);
    d.fillEllipse(x + 22, cy + 7, x + 30, cy + 15, GOLD);
    cy = textBlock(d, x + 42, cy, lines, s.font, s.size, CARD, 22);
    cy += 4;
  }
}

function drawFooter(d, f) {
  d.thickLine(MARGIN, 928, MARGIN + CONTENT_W, 928, RULE, 2);
  const s = f.slot("footer");
  d.text(s.font, MARGIN, 944,
    "Drawn from reports published on 25 November 2026  ·  One day, one image",
    s.size, MUTED);
}

export function render(regularFontPath, boldFontPath, outPath) {
  const regular = new Font(regularFontPath);
  const bold = new Font(boldFontPath);
  const fonts = new Fonts(regular, bold);
  const d = new Canvas(SIZE, SIZE, BG);
  drawMasthead(d, fonts);

  const colW = Math.floor((CONTENT_W - 2 * 16) / 3);
  const xs = [MARGIN, MARGIN + colW + 16, MARGIN + 2 * (colW + 16)];
  drawLead(d, fonts, [MARGIN, 206, CONTENT_W, 200]);
  for (let i = 0; i < 3; i++) {
    drawCard(d, fonts, [xs[i], 422, colW, 220], CARDS[i]);
  }
  for (let i = 0; i < 2; i++) {
    drawCard(d, fonts, [xs[i], 658, colW, 256], CARDS[3 + i]);
  }
  drawAlsoToday(d, fonts, [xs[2], 658, colW, 256]);
  drawFooter(d, fonts);

  writeFileSync(outPath, encodePNG(d));
  return outPath;
}

export function fontPaths() {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    regular: join(here, "fonts", "LiberationSans-Regular.subset.ttf"),
    bold: join(here, "fonts", "LiberationSans-Bold.subset.ttf"),
  };
}
