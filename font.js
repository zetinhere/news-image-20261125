// font.js — a tiny TrueType reader and glyph rasterizer, pure Node.js.
//
// Reads the subsetted Liberation Sans fonts shipped in ../fonts and draws
// text the way the PIL render did: same advances, same GPOS kerning, same
// ascender-top anchor. No system fonts, no hinting, no network, no deps.
//
// Shaping pipeline: cmap (format 4/12) -> glyph id -> glyf outline
// (simple or composite) -> quadratic flattening -> 4x supersampled
// even-odd scanline fill -> grayscale coverage bitmap, blitted with
// alpha blending. Advances accumulate fractionally, exactly like
// FreeType's 26.6 pen, and each glyph bitmap is placed at the rounded
// pen position.

import { readFileSync } from "node:fs";

const SS = 4; // supersampling factor per axis for antialiased glyphs

function u16(dv, o) { return dv.getUint16(o, false); }
function i16(dv, o) { return dv.getInt16(o, false); }
function u32(dv, o) { return dv.getUint32(o, false); }

class Reader {
  constructor(buffer) {
    this.buf = buffer;
    this.dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.tables = new Map();
    const numTables = u16(this.dv, 4);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(
        this.dv.getUint8(o), this.dv.getUint8(o + 1),
        this.dv.getUint8(o + 2), this.dv.getUint8(o + 3));
      this.tables.set(tag, { offset: u32(this.dv, o + 8), length: u32(this.dv, o + 12) });
    }
  }
  table(tag) {
    const t = this.tables.get(tag);
    if (!t) return null;
    return { dv: this.dv, offset: t.offset, length: t.length };
  }
}

// --- cmap ---------------------------------------------------------------
function parseCmap(dv, off) {
  const numTables = u16(dv, off + 2);
  let fmt4 = -1, fmt12 = -1;
  for (let i = 0; i < numTables; i++) {
    const platform = u16(dv, off + 4 + i * 8);
    const encoding = u16(dv, off + 6 + i * 8);
    const sub = u32(dv, off + 8 + i * 8);
    const format = u16(dv, off + sub);
    if (format === 12) fmt12 = off + sub;
    else if (format === 4 && fmt4 < 0) fmt4 = off + sub;
    void platform; void encoding;
  }
  const map = new Map();
  if (fmt12 >= 0) {
    const nGroups = u32(dv, fmt12 + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = fmt12 + 16 + i * 12;
      const start = u32(dv, g), end = u32(dv, g + 4), glyph = u32(dv, g + 8);
      for (let c = start; c <= end; c++) map.set(c, glyph + (c - start));
    }
    return map;
  }
  // format 4
  const segCount = u16(dv, fmt4 + 6) / 2;
  const endBase = fmt4 + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;
  for (let s = 0; s < segCount; s++) {
    const end = u16(dv, endBase + s * 2);
    const start = u16(dv, startBase + s * 2);
    const delta = i16(dv, deltaBase + s * 2);
    const rangeOff = u16(dv, rangeBase + s * 2);
    for (let c = start; c <= end; c++) {
      if (c === 0xffff) continue;
      let gid;
      if (rangeOff === 0) {
        gid = (c + delta) & 0xffff;
      } else {
        const addr = rangeBase + s * 2 + rangeOff + (c - start) * 2;
        const g = u16(dv, addr);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      map.set(c, gid);
    }
  }
  return map;
}

// --- GPOS kern, lookup type 2 format 1 only ----------------------------
function parseKern(dv, off) {
  const kern = new Map(); // "gid1,gid2" -> xAdvance adjustment (font units)
  if (off < 0) return kern;
  const featureBase = off + u16(dv, off + 6);
  const lookupBase = off + u16(dv, off + 8);
  const featureCount = u16(dv, featureBase);
  const kernLookups = [];
  for (let i = 0; i < featureCount; i++) {
    const rec = featureBase + 2 + i * 6;
    const tag = String.fromCharCode(
      dv.getUint8(rec), dv.getUint8(rec + 1),
      dv.getUint8(rec + 2), dv.getUint8(rec + 3));
    if (tag !== "kern") continue;
    const feat = featureBase + u16(dv, rec + 4);
    const n = u16(dv, feat + 2);
    for (let j = 0; j < n; j++) kernLookups.push(u16(dv, feat + 4 + j * 2));
  }
  const lookupCount = u16(dv, lookupBase);
  for (const li of kernLookups) {
    if (li >= lookupCount) continue;
    const lookup = lookupBase + u16(dv, lookupBase + 2 + li * 2);
    if (u16(dv, lookup) !== 2) continue; // PairAdjustment only
    const subCount = u16(dv, lookup + 4);
    for (let s = 0; s < subCount; s++) {
      const sub = lookup + u16(dv, lookup + 6 + s * 2);
      if (u16(dv, sub) !== 1) continue; // PairSet format only
      const valueFormat1 = u16(dv, sub + 4);
      if ((valueFormat1 & 0x0004) === 0) continue; // need XAdvance
      const valueRecordSize = 2 * countBits(valueFormat1);
      const pairSetCount = u16(dv, sub + 8);
      const covBase = sub + u16(dv, sub + 2);
      const firstGlyphs = coverageGlyphs(dv, covBase);
      for (let p = 0; p < pairSetCount; p++) {
        const ps = sub + u16(dv, sub + 10 + p * 2);
        const pairCount = u16(dv, ps);
        for (let q = 0; q < pairCount; q++) {
          const rec = ps + 2 + q * (2 + valueRecordSize);
          const second = u16(dv, rec);
          // XAdvance is the first value field when its bit is set and
          // no earlier value bits are present; walk the format bits.
          let fieldOff = rec + 2;
          let xAdvance = 0;
          const bits = [0x0001, 0x0002, 0x0004, 0x0008, 0x0010, 0x0020, 0x0040, 0x0080];
          for (const bit of bits) {
            if (valueFormat1 & bit) {
              if (bit === 0x0004) xAdvance = i16(dv, fieldOff);
              fieldOff += 2;
            }
          }
          kern.set(`${firstGlyphs[p]},${second}`, xAdvance);
        }
      }
    }
  }
  return kern;
}

function countBits(v) {
  let n = 0;
  while (v) { n += v & 1; v >>= 1; }
  return n;
}

function coverageGlyphs(dv, off) {
  const format = u16(dv, off);
  if (format === 1) {
    const n = u16(dv, off + 2);
    const out = [];
    for (let i = 0; i < n; i++) out.push(u16(dv, off + 4 + i * 2));
    return out;
  }
  const n = u16(dv, off + 2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = off + 4 + i * 6;
    const start = u16(dv, r), end = u16(dv, r + 2);
    for (let g = start; g <= end; g++) out.push(g);
  }
  return out;
}

// --- glyf ---------------------------------------------------------------
function parseGlyph(dv, glyfOff, glyphOff, glyphEnd, loca, glyphs, depth) {
  if (glyphOff >= glyphEnd || depth > 4) return [];
  const o = glyfOff + glyphOff;
  const numContours = i16(dv, o);
  if (numContours >= 0) return parseSimpleGlyph(dv, o, numContours);
  // Composite glyph: walk components, apply each transform, recurse.
  let p = o + 10;
  const contours = [];
  for (;;) {
    const flags = u16(dv, p);
    const compGid = u16(dv, p + 2);
    p += 4;
    let dx = 0, dy = 0;
    if (flags & 0x0001) { dx = i16(dv, p); dy = i16(dv, p + 2); p += 4; }
    else { dx = dv.getInt8(p); dy = dv.getInt8(p + 1); p += 2; }
    let a = 1, b = 0, c = 0, d = 1; // x' = a*x + b*y + dx ; y' = c*x + d*y + dy
    if (flags & 0x0008) {
      const s = i16(dv, p) / 16384; p += 2;
      a = s; d = s;
    } else if (flags & 0x0040) {
      a = i16(dv, p) / 16384; d = i16(dv, p + 2) / 16384; p += 4;
    } else if (flags & 0x0080) {
      a = i16(dv, p) / 16384; b = i16(dv, p + 2) / 16384;
      c = i16(dv, p + 4) / 16384; d = i16(dv, p + 6) / 16384; p += 8;
    }
    const compOff = glyphOffset(loca, compGid);
    const compEnd = glyphOffset(loca, compGid + 1);
    for (const contour of parseGlyph(dv, glyfOff, compOff, compEnd, loca, glyphs, depth + 1)) {
      contours.push(contour.map((pt) => ({
        x: a * pt.x + b * pt.y + dx,
        y: c * pt.x + d * pt.y + dy,
        onCurve: pt.onCurve,
      })));
    }
    if (!(flags & 0x0020)) break;
  }
  return contours;
}

function glyphOffset(loca, gid) {
  return loca.offsets[gid];
}

function parseSimpleGlyph(dv, o, numContours) {
  let p = o + 10;
  const endPts = [];
  for (let i = 0; i < numContours; i++) { endPts.push(u16(dv, p)); p += 2; }
  const numPoints = numContours === 0 ? 0 : endPts[endPts.length - 1] + 1;
  const instrLen = u16(dv, p);
  p += 2 + instrLen;
  const flags = [];
  while (flags.length < numPoints) {
    const f = dv.getUint8(p++);
    flags.push(f);
    if (f & 0x08) {
      const rep = dv.getUint8(p++);
      for (let i = 0; i < rep; i++) flags.push(f);
    }
  }
  const xs = [];
  let x = 0;
  for (let i = 0; i < numPoints; i++) {
    const f = flags[i];
    if (f & 0x02) {
      const v = dv.getUint8(p++);
      x += (f & 0x10) ? v : -v;
    } else if (!(f & 0x10)) {
      x += i16(dv, p); p += 2;
    }
    xs.push(x);
  }
  const ys = [];
  let y = 0;
  for (let i = 0; i < numPoints; i++) {
    const f = flags[i];
    if (f & 0x04) {
      const v = dv.getUint8(p++);
      y += (f & 0x20) ? v : -v;
    } else if (!(f & 0x20)) {
      y += i16(dv, p); p += 2;
    }
    ys.push(y);
  }
  const contours = [];
  let start = 0;
  for (const end of endPts) {
    const contour = [];
    for (let i = start; i <= end; i++) {
      contour.push({ x: xs[i], y: ys[i], onCurve: (flags[i] & 0x01) !== 0 });
    }
    contours.push(contour);
    start = end + 1;
  }
  return contours;
}

// --- outline flattening + rasterization ---------------------------------
function contourToPolyline(contour) {
  // Insert implied on-curve midpoints between consecutive off-curve
  // points, then walk the closed contour emitting line segments and
  // flattened quadratics.
  const pts = [];
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const cur = contour[i];
    const nxt = contour[(i + 1) % n];
    pts.push(cur);
    if (!cur.onCurve && !nxt.onCurve) {
      pts.push({ x: (cur.x + nxt.x) / 2, y: (cur.y + nxt.y) / 2, onCurve: true });
    }
  }
  // Rotate so the polyline starts on an on-curve point.
  let start = 0;
  while (start < pts.length && !pts[start].onCurve) start++;
  if (start === pts.length) return []; // degenerate contour
  const ordered = pts.slice(start).concat(pts.slice(0, start));
  const poly = [];
  let pen = ordered[0];
  poly.push([pen.x, pen.y]);
  let i = 1;
  while (i < ordered.length) {
    const pt = ordered[i];
    if (pt.onCurve) {
      poly.push([pt.x, pt.y]);
      pen = pt;
      i++;
    } else {
      const end = ordered[(i + 1) % ordered.length];
      const steps = Math.max(4, Math.min(32,
        Math.ceil(Math.hypot(end.x - pen.x, end.y - pen.y) / 64)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        poly.push([
          mt * mt * pen.x + 2 * mt * t * pt.x + t * t * end.x,
          mt * mt * pen.y + 2 * mt * t * pt.y + t * t * end.y,
        ]);
      }
      pen = end;
      i += 2;
    }
  }
  return poly;
}

function rasterizeContours(contours, scale) {
  // Returns { w, h, left, top, data } — data is a grayscale coverage
  // bitmap, w*h bytes, origin at (left, top) in pixels relative to the
  // glyph pen origin, with the baseline at y = -top.
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const contour of contours) {
    for (const pt of contour) {
      if (pt.x < xMin) xMin = pt.x;
      if (pt.x > xMax) xMax = pt.x;
      if (pt.y < yMin) yMin = pt.y;
      if (pt.y > yMax) yMax = pt.y;
    }
  }
  if (!isFinite(xMin)) return { w: 0, h: 0, left: 0, top: 0, data: new Uint8Array(0) };
  const left = Math.floor(xMin * scale);
  const right = Math.ceil(xMax * scale);
  const top = Math.floor(-yMax * scale);
  const bottom = Math.ceil(-yMin * scale);
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  // Flatten every contour into subpixel polylines.
  const polys = [];
  for (const contour of contours) {
    const poly = contourToPolyline(contour).map(([x, y]) => [
      (x * scale - left) * SS,
      (-y * scale - top) * SS,
    ]);
    if (poly.length > 1) polys.push(poly);
  }
  const sw = w * SS, sh = h * SS;
  const mask = new Uint8Array(sw * sh);
  for (let row = 0; row < sh; row++) {
    const yc = row + 0.5;
    const xs = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        if (y0 === y1) continue;
        if ((y0 <= yc && yc < y1) || (y1 <= yc && yc < y0)) {
          xs.push(x0 + (yc - y0) * (x1 - x0) / (y1 - y0));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(sw - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let c = c0; c <= c1; c++) mask[row * sw + c] = 1;
    }
  }
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let sy = 0; sy < SS; sy++) {
        const base = (y * SS + sy) * sw + x * SS;
        for (let sx = 0; sx < SS; sx++) sum += mask[base + sx];
      }
      data[y * w + x] = Math.round(sum * 255 / (SS * SS));
    }
  }
  return { w, h, left, top, data };
}

// --- the font ------------------------------------------------------------
export class Font {
  constructor(path) {
    const buffer = readFileSync(path);
    const reader = new Reader(buffer);
    this.dv = reader.dv;
    const head = reader.table("head");
    this.unitsPerEm = u16(this.dv, head.offset + 18);
    this.indexToLocFormat = i16(this.dv, head.offset + 50);
    const maxp = reader.table("maxp");
    this.numGlyphs = u16(this.dv, maxp.offset + 4);
    const hhea = reader.table("hhea");
    this.ascent = i16(this.dv, hhea.offset + 4);
    this.descent = i16(this.dv, hhea.offset + 6);
    this.numHMetrics = u16(this.dv, hhea.offset + 34);
    const hmtx = reader.table("hmtx");
    this.advances = new Uint16Array(this.numGlyphs);
    for (let g = 0; g < this.numGlyphs; g++) {
      const idx = Math.min(g, this.numHMetrics - 1);
      this.advances[g] = u16(this.dv, hmtx.offset + idx * 4);
    }
    const locaT = reader.table("loca");
    this.loca = { offsets: new Uint32Array(this.numGlyphs + 1) };
    for (let g = 0; g <= this.numGlyphs; g++) {
      this.loca.offsets[g] = this.indexToLocFormat === 0
        ? u16(this.dv, locaT.offset + g * 2) * 2
        : u32(this.dv, locaT.offset + g * 4);
    }
    const glyfT = reader.table("glyf");
    this.glyfOffset = glyfT.offset;
    const cmapT = reader.table("cmap");
    this.cmap = parseCmap(this.dv, cmapT.offset);
    const gposT = reader.table("GPOS");
    this.kern = gposT ? parseKern(this.dv, gposT.offset) : new Map();
    this.outlineCache = new Map();
    this.bitmapCache = new Map();
  }

  glyphId(charCode) {
    return this.cmap.get(charCode) ?? 0;
  }

  outline(gid) {
    let contours = this.outlineCache.get(gid);
    if (contours) return contours;
    const off = this.loca.offsets[gid];
    const end = this.loca.offsets[gid + 1];
    contours = parseGlyph(this.dv, this.glyfOffset, off, end, this.loca, null, 0);
    this.outlineCache.set(gid, contours);
    return contours;
  }

  // Glyph ids for a string, in order.
  glyphIds(text) {
    const ids = [];
    for (const ch of text) ids.push(this.glyphId(ch.codePointAt(0)));
    return ids;
  }

  kernAdj(g1, g2) {
    return this.kern.get(`${g1},${g2}`) ?? 0;
  }

  // Advance width of a string in pixels at the given size, kerning
  // included — the same number PIL's textlength returns.
  measure(text, size) {
    const scale = size / this.unitsPerEm;
    const ids = this.glyphIds(text);
    let total = 0;
    for (let i = 0; i < ids.length; i++) {
      total += this.advances[ids[i]];
      if (i + 1 < ids.length) total += this.kernAdj(ids[i], ids[i + 1]);
    }
    return total * scale;
  }

  bitmap(gid, size) {
    const key = `${gid}:${size}`;
    let bm = this.bitmapCache.get(key);
    if (bm) return bm;
    const scale = size / this.unitsPerEm;
    bm = rasterizeContours(this.outline(gid), scale);
    bm.advance = this.advances[gid] * scale;
    this.bitmapCache.set(key, bm);
    return bm;
  }

  // Draw text at (x, y) with PIL's default "la" anchor: x is the left
  // edge, y is the top of the ascender. `draw` is the canvas blitter:
  // draw(bm, destX, destY, color).
  drawText(draw, x, y, text, size, color) {
    const scale = size / this.unitsPerEm;
    const baseline = y + this.ascent * scale;
    const ids = this.glyphIds(text);
    let pen = x;
    for (let i = 0; i < ids.length; i++) {
      const gid = ids[i];
      if (gid !== 0) {
        const bm = this.bitmap(gid, size);
        if (bm.w > 0) {
          draw(bm, Math.round(pen + bm.left), Math.round(baseline + bm.top), color);
        }
      }
      let adv = this.advances[gid] * scale;
      if (i + 1 < ids.length) adv += this.kernAdj(gid, ids[i + 1]) * scale;
      pen += adv;
    }
  }
}
