/**
 * Extracts sampled player positions from a CS2 .dem for the 2D viewer.
 * Usage: node scripts/export-demo.mjs [path/to/demo.dem] [path/to/out.json]
 * Default output: public/demo-data.json
 * Env: TICK_STEP (default 1) — export every Nth demo tick only (16 ≈ smaller JSON).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exportDemoBuffer } from "./demo-buffer-to-json.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const demoArg = process.argv[2];
const demoPath = demoArg
  ? path.resolve(demoArg)
  : path.join(root, "natus-vincere-vs-vitality-m3-dust2.dem");

const TICK_STEP = Number(process.env.TICK_STEP || 1);

if (!fs.existsSync(demoPath)) {
  console.error(`Demo not found: ${demoPath}`);
  process.exit(1);
}

console.warn(`Parsing ticks (this can take ~20–60s on long demos)…`);

const buf = fs.readFileSync(demoPath);
const out = await exportDemoBuffer(buf, {
  demoPathLabel: path.basename(demoPath),
  tickStep: TICK_STEP,
});

const outPathArg = process.argv[3];
const outPath = outPathArg
  ? path.resolve(outPathArg)
  : path.join(root, "public", "demo-data.json");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));

console.warn(
  `Wrote ${outPath} (${out.frames.length} sampled ticks, ${out.players.length} players, ${out.shots.length} gun fires, ${out.utilities.length} utility throws, map ${out.mapName})`,
);
