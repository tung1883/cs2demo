import type { CoachTool, Drawing } from "./coachTools";
import { CoachStore } from "./coachTools";

type Point = { x: number; y: number };

export class CoachInput {
  tool: CoachTool = "select";
  color = "#3ddc97";
  strokeWidth = 3;

  private dragging = false;
  private points: Point[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private store: CoachStore,
    private getRound: () => number,
    private canvasToWorld: (cx: number, cy: number) => Point,
    private onChange: () => void,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  /** In-progress drawing for live preview while dragging, or `null`. */
  currentPreview: Drawing | null = null;

  private toCanvasLocal(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (this.tool === "select") return;
    this.dragging = true;
    const local = this.toCanvasLocal(ev.clientX, ev.clientY);
    this.points = [this.canvasToWorld(local.x, local.y)];
    this.currentPreview = {
      id: "preview",
      roundIdx: this.getRound(),
      tool: this.tool,
      color: this.color,
      strokeWidth: this.strokeWidth,
      points: [...this.points],
    };
    this.onChange();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.dragging) return;
    const local = this.toCanvasLocal(ev.clientX, ev.clientY);
    const wp = this.canvasToWorld(local.x, local.y);
    if (this.tool === "path" || this.tool === "grenade-path") {
      this.points.push(wp);
    } else {
      this.points = [this.points[0], wp];
    }
    this.currentPreview = {
      id: "preview",
      roundIdx: this.getRound(),
      tool: this.tool,
      color: this.color,
      strokeWidth: this.strokeWidth,
      points: [...this.points],
    };
    this.onChange();
  };

  private onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.currentPreview = null;
    if (this.points.length >= 2) {
      this.store.add(this.getRound(), this.tool, this.color, this.strokeWidth, this.points);
    }
    this.points = [];
    this.onChange();
  };
}
