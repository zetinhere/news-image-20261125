// Entry point for the news-image-20261125 make.fun bounty.
//
// Renders the front page in pure Node.js and drops the PNG into the
// output directory the grader provides. No external programs: the
// pinned node:22 grader image ships no python3, no Pillow and no
// system fonts, which is exactly why the first submission exited 1 —
// its main.ts shelled out to `python3 draw.py`. The renderer here
// (draw.js + font.js + canvas.js + png.js) draws the same front page
// with the subsetted Liberation Sans fonts in ./fonts, so the run
// needs nothing beyond node itself. The render is fully deterministic,
// so repeated runs write identical bytes. Any failure throws, so the
// process exits non-zero instead of writing a partial image.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fontPaths, render } from "./draw.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR?.trim() || "out";
const target = resolve(outDir, "entry.png");

mkdirSync(outDir, { recursive: true });
const fonts = fontPaths();
render(fonts.regular, fonts.bold, target);

if (!existsSync(target)) {
  throw new Error(`render did not produce ${target}`);
}
const bytes = statSync(target).size;
if (bytes === 0) {
  throw new Error(`${target} is empty`);
}
console.log(`wrote ${target} (${bytes} bytes)`);
