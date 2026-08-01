/**
 * Extracts sampled player positions from a CS2 .dem for the 2D viewer.
 * Usage: node scripts/export-demo.mjs [path/to/demo.dem] [path/to/out.json]
 * Default output: public/demo-data.json
 * Env: TICK_STEP (default 1) — export every Nth demo tick only (16 ≈ smaller JSON).
 *
 * Uses the same batched parser calls as the browser export path
 * (src/demo-export/buildDemoData.ts): one parseTicks pass plus two grouped
 * parseEvents passes instead of ~9 separate ones, and includes kill/round-
 * result data the old scripts/demo-buffer-to-json.mjs path didn't parse.
 *
 * `parseTicks` alone dominates total wall time (it replays and scans every
 * tick) and already parallelizes internally — running it concurrently with
 * the (much cheaper) event passes in separate worker threads was tried and
 * measured *slower* due to native thread-pool contention, so this stays
 * sequential.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseHeader,
  parseTicks,
  parseEvents,
  parsePlayerInfo,
} from "@laihoe/demoparser2";
import { buildDemoData } from "../src/demo-export/buildDemoData.ts";

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

console.warn(`Parsing ticks (this can take ~20–90s on long demos)…`);

const buf = fs.readFileSync(demoPath);

const out = await buildDemoData(
  buf,
  {
    parseHeader,
    // Native parseTicks is (buf, wantedProps, wantedTicks, wantedPlayers, structOfArrays, ...) —
    // wantedPlayers sits before structOfArrays, so pass it explicitly as null.
    parseTicks: (f, props, ticks, soa) =>
      parseTicks(f, props ?? undefined, ticks ?? undefined, null, soa ?? undefined),
    parseEvents,
    parsePlayerInfo,
  },
  { demoPathLabel: path.basename(demoPath), tickStep: TICK_STEP },
);

const outPathArg = process.argv[3];
const outPath = outPathArg
  ? path.resolve(outPathArg)
  : path.join(root, "public", "demo-data.json");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));

console.warn(
  `Wrote ${outPath} (${out.frames.length} sampled ticks, ${out.players.length} players, ${out.shots.length} gun fires, ${out.utilities.length} utility throws, ${out.kills?.length ?? 0} kills, map ${out.mapName})`,
);
