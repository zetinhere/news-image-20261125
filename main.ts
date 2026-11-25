import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Entrypoint for the graded runs. The picture itself is drawn at build
// time by draw.py (PIL, no network); this program only copies the finished
// entry.png into the output directory, so both runs write identical bytes.
const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const png = readFileSync(join(here, "entry.png"));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), png);
