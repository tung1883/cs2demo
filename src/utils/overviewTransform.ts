import type { MapOverviewConfig } from "../mapOverview";

export function worldToOverviewPixel(
  worldX: number,
  worldY: number,
  cfg: MapOverviewConfig,
): { px: number; py: number } {
  const px = (worldX - cfg.posX) / cfg.scale;
  const py = (cfg.posY - worldY) / cfg.scale;
  return { px, py };
}

/** Overview pixel (top-left origin) → canvas, letterboxed square */
export function overviewPixelToCanvas(
  px: number,
  py: number,
  cfg: MapOverviewConfig,
  cw: number,
  ch: number,
): { x: number; y: number; ox: number; oy: number; side: number } {
  const n = cfg.overviewPx || 1024;
  const side = Math.min(cw, ch);
  const ox = (cw - side) / 2;
  const oy = (ch - side) / 2;
  return {
    x: ox + (px / n) * side,
    y: oy + (py / n) * side,
    ox,
    oy,
    side,
  };
}
