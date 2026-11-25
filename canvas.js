// canvas.js — a small RGB canvas with the PIL-style drawing primitives
// the front page needs: rectangles, polygons, ellipses, rounded
// rectangles, thick lines and arcs. Shapes are drawn aliased, exactly
// like PIL's ImageDraw; only text (see font.js) is antialiased.

export class Canvas {
  constructor(width, height, bg) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.pixels[i * 3] = bg[0];
      this.pixels[i * 3 + 1] = bg[1];
      this.pixels[i * 3 + 2] = bg[2];
    }
  }

  // Blend one glyph-coverage pixel over the canvas.
  blitGlyph(bm, destX, destY, color) {
    for (let y = 0; y < bm.h; y++) {
      const cy = destY + y;
      if (cy < 0 || cy >= this.height) continue;
      for (let x = 0; x < bm.w; x++) {
        const a = bm.data[y * bm.w + x];
        if (a === 0) continue;
        const cx = destX + x;
        if (cx < 0 || cx >= this.width) continue;
        const i = (cy * this.width + cx) * 3;
        if (a === 255) {
          this.pixels[i] = color[0];
          this.pixels[i + 1] = color[1];
          this.pixels[i + 2] = color[2];
        } else {
          const inv = 255 - a;
          this.pixels[i] = (color[0] * a + this.pixels[i] * inv + 127) >> 8;
          this.pixels[i + 1] = (color[1] * a + this.pixels[i + 1] * inv + 127) >> 8;
          this.pixels[i + 2] = (color[2] * a + this.pixels[i + 2] * inv + 127) >> 8;
        }
      }
    }
  }

  // PIL's rectangle([x0, y0, x1, y1]) fills pixels x0..x1, y0..y1
  // inclusive; match that exactly.
  fillRect(x0, y0, x1, y1, color) {
    const xa = Math.max(0, Math.round(x0));
    const xb = Math.min(this.width - 1, Math.round(x1));
    const ya = Math.max(0, Math.round(y0));
    const yb = Math.min(this.height - 1, Math.round(y1));
    for (let y = ya; y <= yb; y++) {
      const base = y * this.width * 3;
      for (let x = xa; x < xb; x++) {
        const i = base + x * 3;
        this.pixels[i] = color[0];
        this.pixels[i + 1] = color[1];
        this.pixels[i + 2] = color[2];
      }
    }
  }

  // Even-odd scanline fill of a simple polygon (float coordinates).
  fillPolygon(points, color) {
    let yMin = Infinity, yMax = -Infinity;
    for (const [, y] of points) {
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const ya = Math.max(0, Math.floor(yMin));
    const yb = Math.min(this.height - 1, Math.ceil(yMax));
    for (let y = ya; y <= yb; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if (y0 === y1) continue;
        if ((y0 <= yc && yc < y1) || (y1 <= yc && yc < y0)) {
          xs.push(x0 + (yc - y0) * (x1 - x0) / (y1 - y0));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(this.width - 1, Math.floor(xs[k + 1] - 0.5));
        const base = y * this.width * 3;
        for (let x = xa; x <= xb; x++) {
          const i = base + x * 3;
          this.pixels[i] = color[0];
          this.pixels[i + 1] = color[1];
          this.pixels[i + 2] = color[2];
        }
      }
    }
  }

  // PIL's ellipse bbox is inclusive too: the ellipse touches the
  // outer edges of the bbox pixels, so it spans [x0, x1+1) x [y0, y1+1)
  // in continuous coordinates.
  fillEllipse(x0, y0, x1, y1, color) {
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
    const rx = (x1 + 1 - x0) / 2, ry = (y1 + 1 - y0) / 2;
    const ya = Math.max(0, Math.floor(y0));
    const yb = Math.min(this.height - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const dx = rx * Math.sqrt(1 - dy * dy);
      const xa = Math.max(0, Math.ceil(cx - dx - 0.5));
      const xb = Math.min(this.width - 1, Math.floor(cx + dx - 0.5));
      const base = y * this.width * 3;
      for (let x = xa; x <= xb; x++) {
        const i = base + x * 3;
        this.pixels[i] = color[0];
        this.pixels[i + 1] = color[1];
        this.pixels[i + 2] = color[2];
      }
    }
  }

  // Ring: outer ellipse filled, inner ellipse cut out in `bg`.
  strokeEllipse(x0, y0, x1, y1, color, width, bg) {
    this.fillEllipse(x0, y0, x1, y1, color);
    this.fillEllipse(x0 + width, y0 + width, x1 - width, y1 - width, bg);
  }

  // A rounded-rectangle path as a polygon (arc corners sampled).
  // Like PIL, the bbox is inclusive: the shape spans [x0, x1+1).
  roundedRectPath(x0, y0, x1, y1, radius) {
    const x1c = x1 + 1, y1c = y1 + 1;
    const r = Math.min(radius, (x1c - x0) / 2, (y1c - y0) / 2);
    const pts = [];
    const corners = [
      [x1c - r, y0 + r, -90, 0],
      [x1c - r, y1c - r, 0, 90],
      [x0 + r, y1c - r, 90, 180],
      [x0 + r, y0 + r, 180, 270],
    ];
    const steps = 10;
    for (const [cx, cy, a0, a1] of corners) {
      for (let s = 0; s <= steps; s++) {
        const a = (a0 + (a1 - a0) * s / steps) * Math.PI / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    }
    return pts;
  }

  fillRoundedRect(x0, y0, x1, y1, radius, color) {
    this.fillPolygon(this.roundedRectPath(x0, y0, x1, y1, radius), color);
  }

  // Outline: outer rounded rect in the outline color, inner rounded
  // rect cut out in `bg` (the surface underneath is uniform here).
  strokeRoundedRect(x0, y0, x1, y1, radius, color, width, bg) {
    this.fillRoundedRect(x0, y0, x1, y1, radius, color);
    this.fillRoundedRect(
      x0 + width, y0 + width, x1 - width, y1 - width,
      Math.max(0, radius - width), bg);
  }

  // Thick line as a quad with butt caps, matching PIL's line().
  // PIL centers the width on the pixel-center row/column the line
  // sits on, so an even width extends one pixel further on one side:
  // a width-2 line at y covers rows y and y+1, a width-4 line rows
  // y-1..y+2. The quad below reproduces that for axis-aligned lines;
  // diagonal lines use the symmetric quad, which PIL matches to the
  // same half pixel.
  thickLine(x0, y0, x1, y1, color, width) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      this.fillRect(x0 - width / 2, y0 - width / 2, x0 + width / 2, y0 + width / 2, color);
      return;
    }
    const nx = -dy / len, ny = dx / len;
    const below = Math.floor((width - 1) / 2) + 0.5;
    const above = Math.ceil((width - 1) / 2) + 0.5;
    let cx0 = x0, cy0 = y0, cx1 = x1, cy1 = y1;
    if (dy === 0) { // horizontal: centre on the pixel-center row
      cy0 = cy1 = Math.floor(y0) + 0.5;
    } else if (dx === 0) { // vertical: centre on the pixel-center column
      cx0 = cx1 = Math.floor(x0) + 0.5;
    }
    this.fillPolygon([
      [cx0 + nx * above, cy0 + ny * above],
      [cx1 + nx * above, cy1 + ny * above],
      [cx1 - nx * below, cy1 - ny * below],
      [cx0 - nx * below, cy0 - ny * below],
    ], color);
  }

  // PIL arc: degrees from 3 o'clock, increasing clockwise, y down.
  // The bbox is inclusive, so the ellipse spans [x0, x1+1).
  arc(x0, y0, x1, y1, startDeg, endDeg, color, width) {
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
    const rx = (x1 + 1 - x0) / 2, ry = (y1 + 1 - y0) / 2;
    const steps = Math.max(8, Math.ceil(Math.abs(endDeg - startDeg) / 4));
    let prev = null;
    const r = width / 2;
    for (let s = 0; s <= steps; s++) {
      const a = (startDeg + (endDeg - startDeg) * s / steps) * Math.PI / 180;
      const pt = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
      if (prev) {
        this.thickLine(prev[0], prev[1], pt[0], pt[1], color, width);
        // Round the joint so the curve has no notches on its outer edge.
        this.fillEllipse(pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r, color);
      }
      prev = pt;
    }
  }

  // Text: delegates shaping to the font; `font` is a Font, `size` px.
  text(font, x, y, str, size, color) {
    font.drawText((bm, dx, dy) => this.blitGlyph(bm, dx, dy, color), x, y, str, size, color);
  }

  textLength(font, str, size) {
    return font.measure(str, size);
  }
}
