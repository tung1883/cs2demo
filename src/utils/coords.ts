import type { Frame, ShotTuple } from "../demoTypes";

function extendBoundsFromXY(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  rows: readonly ShotTuple[] | undefined,
): [number, number, number, number] {
  let a = minX;
  let b = maxX;
  let c = minY;
  let d = maxY;
  if (!rows) return [a, b, c, d];
  for (const s of rows) {
    const x = s[1];
    const y = s[2];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    a = Math.min(a, x);
    b = Math.max(b, x);
    c = Math.min(c, y);
    d = Math.max(d, y);
  }
  return [a, b, c, d];
}

export type BoundingBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pad: number;
};

/** Min/max world X/Y from movement samples, shots, utilities, grenade FX points */
export function computeSceneBounds(
  frames: Frame[],
  shots?: readonly ShotTuple[] | undefined,
  utilities?: readonly ShotTuple[] | undefined,
  ...moreXY: (readonly ShotTuple[] | undefined)[]
): BoundingBox | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [, , players] of frames) {
    for (const pl of players) {
      const [, x, y] = pl;
      const nx = typeof x === "number" ? x : Number(x);
      const ny = typeof y === "number" ? y : Number(y);
      minX = Math.min(minX, nx);
      maxX = Math.max(maxX, nx);
      minY = Math.min(minY, ny);
      maxY = Math.max(maxY, ny);
    }
  }

  ;[minX, maxX, minY, maxY] = extendBoundsFromXY(minX, maxX, minY, maxY, shots);
  ;[minX, maxX, minY, maxY] = extendBoundsFromXY(minX, maxX, minY, maxY, utilities);
  for (const rows of moreXY) {
    ;[minX, maxX, minY, maxY] = extendBoundsFromXY(minX, maxX, minY, maxY, rows);
  }

  if (!Number.isFinite(minX)) return null;

  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 || 200;
  return { minX, maxX, minY, maxY, pad };
}

export function worldToCanvasBBox(
  x: number,
  y: number,
  b: BoundingBox,
  cw: number,
  ch: number,
): { x: number; y: number } {
  const { minX, maxX, minY, maxY, pad } = b;
  const spanX = maxX - minX + pad * 2 || 1;
  const spanY = maxY - minY + pad * 2 || 1;
  const nx = (x - minX + pad) / spanX;
  const ny = (y - minY + pad) / spanY;
  return { x: nx * cw, y: ch - ny * ch };
}
