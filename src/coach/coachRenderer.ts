import type { Drawing } from "./coachTools";

type Point = { x: number; y: number };
type WorldToCanvas = (wx: number, wy: number) => Point;

function drawArrowhead(ctx: CanvasRenderingContext2D, from: Point, to: Point, size: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawOne(ctx: CanvasRenderingContext2D, d: Drawing, toCanvas: WorldToCanvas): void {
  const pts = d.points.map((p) => toCanvas(p.x, p.y));
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = d.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (d.tool) {
    case "rect": {
      if (pts.length < 2) break;
      const [a, b] = pts;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    }
    case "circle": {
      if (pts.length < 2) break;
      const [a, b] = pts;
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "arrow": {
      if (pts.length < 2) break;
      const [a, b] = pts;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      drawArrowhead(ctx, a, b, 8 + d.strokeWidth * 2);
      break;
    }
    case "path":
    case "grenade-path": {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      if (d.tool === "grenade-path") ctx.setLineDash([d.strokeWidth * 2, d.strokeWidth * 1.5]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (d.tool === "grenade-path" && pts.length >= 2) {
        drawArrowhead(ctx, pts[pts.length - 2], pts[pts.length - 1], 8 + d.strokeWidth * 2);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

export function renderCoachOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  drawings: Drawing[],
  toCanvas: WorldToCanvas,
  inProgress?: Drawing | null,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  for (const d of drawings) drawOne(ctx, d, toCanvas);
  if (inProgress) drawOne(ctx, inProgress, toCanvas);
}
