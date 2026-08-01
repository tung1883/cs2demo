import type { DemoData, Frame } from "../demoTypes";
import type { BoundingBox } from "./coords";

export type ViewportMode =
  | { kind: "fixed" }
  | { kind: "auto-zoom" }
  | { kind: "follow"; playerIdx: number };

/** World-unit floor so a 1v1 (or a single alive player) doesn't zoom to an absurdly tight box. */
const MIN_ZOOM_HALF_EXTENT = 600;
const FOLLOW_HALF_EXTENT = 900;

/**
 * Effective world-space viewport for the current frame under the active mode.
 * `worldXYToCanvas`/`worldRadiusToCanvasPx`/the map-image draw all consult this
 * instead of the static scene bbox when zoomed/following, so none of the ~15
 * existing draw call sites need to change.
 */
export function computeEffectiveBBox(
  mode: ViewportMode,
  data: DemoData | null,
  frameIndex: number,
  staticBbox: BoundingBox,
): BoundingBox {
  if (mode.kind === "fixed" || !data?.frames.length) return staticBbox;
  const frame = data.frames[frameIndex];
  if (!frame) return staticBbox;

  if (mode.kind === "auto-zoom") {
    return boundingBoxForAlivePlayers(frame, staticBbox);
  }

  const pos = findPlayerPosition(data, frameIndex, mode.playerIdx);
  if (!pos) return staticBbox;
  const half = FOLLOW_HALF_EXTENT;
  return {
    minX: pos.x - half,
    maxX: pos.x + half,
    minY: pos.y - half,
    maxY: pos.y + half,
    pad: half * 0.2,
  };
}

function boundingBoxForAlivePlayers(frame: Frame, staticBbox: BoundingBox): BoundingBox {
  const players = frame[2];
  if (!players.length) return staticBbox;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pl of players) {
    const x = Number(pl[1]);
    const y = Number(pl[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return staticBbox;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max((maxX - minX) / 2, (maxY - minY) / 2, MIN_ZOOM_HALF_EXTENT);
  const pad = half * 0.25;
  return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half, pad };
}

/** How far back (in sampled frames) to search for a dead/absent player's last known spot before giving up. */
const LOOKBACK_FRAME_LIMIT = 4000;

/** Current frame's position for `idx`, or the last known one walking backward through prior frames. */
function findPlayerPosition(
  data: DemoData,
  frameIndex: number,
  idx: number,
): { x: number; y: number } | undefined {
  const floor = Math.max(0, frameIndex - LOOKBACK_FRAME_LIMIT);
  for (let i = frameIndex; i >= floor; i--) {
    const row = data.frames[i]?.[2].find((pl) => Number(pl[0]) === idx);
    if (row) return { x: Number(row[1]), y: Number(row[2]) };
  }
  return undefined;
}
