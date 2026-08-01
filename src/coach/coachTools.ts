export type CoachTool = "select" | "rect" | "circle" | "arrow" | "path" | "grenade-path";

export type Drawing = {
  id: string;
  roundIdx: number;
  tool: CoachTool;
  color: string;
  strokeWidth: number;
  /** World-space points; rect/circle/arrow use 2 (start, end), path/grenade-path use N. */
  points: { x: number; y: number }[];
};

let nextId = 1;

/**
 * In-memory coach-mode drawing store, keyed by round — cleared on demo
 * reload, not persisted beyond a session export (see `src/session/`).
 */
export class CoachStore {
  private byRound = new Map<number, Drawing[]>();
  private undoStack: { round: number; drawing: Drawing }[] = [];
  private redoStack: { round: number; drawing: Drawing }[] = [];

  add(roundIdx: number, tool: CoachTool, color: string, strokeWidth: number, points: { x: number; y: number }[]): Drawing {
    const drawing: Drawing = { id: `d${nextId++}`, roundIdx, tool, color, strokeWidth, points };
    const arr = this.byRound.get(roundIdx) ?? [];
    arr.push(drawing);
    this.byRound.set(roundIdx, arr);
    this.undoStack.push({ round: roundIdx, drawing });
    this.redoStack = [];
    return drawing;
  }

  forRound(roundIdx: number): Drawing[] {
    return this.byRound.get(roundIdx) ?? [];
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    const arr = this.byRound.get(entry.round);
    if (arr) {
      const idx = arr.findIndex((d) => d.id === entry.drawing.id);
      if (idx >= 0) arr.splice(idx, 1);
    }
    this.redoStack.push(entry);
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    const arr = this.byRound.get(entry.round) ?? [];
    arr.push(entry.drawing);
    this.byRound.set(entry.round, arr);
    this.undoStack.push(entry);
  }

  clearRound(roundIdx: number): void {
    this.byRound.delete(roundIdx);
    this.undoStack = this.undoStack.filter((e) => e.round !== roundIdx);
    this.redoStack = this.redoStack.filter((e) => e.round !== roundIdx);
  }

  clearAll(): void {
    this.byRound.clear();
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Snapshot for session export. */
  toJSON(): Record<number, Drawing[]> {
    return Object.fromEntries(this.byRound);
  }

  /** Restore from a session import. */
  loadFromJSON(data: Record<string, Drawing[]>): void {
    this.clearAll();
    for (const [round, drawings] of Object.entries(data)) {
      this.byRound.set(Number(round), drawings);
    }
  }
}
