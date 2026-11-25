// Entry point for the news-image-20261125 make.fun bounty.
//
// Renders the front page with draw.py (PIL, no network) and drops the PNG
// into the output directory the grader provides. The render is fully
// deterministic, so repeated runs write identical bytes.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR?.trim() || "out";
const target = resolve(outDir, "entry.png");

mkdirSync(outDir, { recursive: true });
execFileSync("python3", ["draw.py", target], { cwd: here, stdio: "inherit" });

if (!existsSync(target)) {
  throw new Error(`draw.py did not produce ${target}`);
}
const bytes = statSync(target).size;
if (bytes === 0) {
  throw new Error(`${target} is empty`);
}
console.log(`wrote ${target} (${bytes} bytes)`);
