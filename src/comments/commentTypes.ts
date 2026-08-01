export type CommentKind = "note" | "positive" | "mistake" | "caution" | "idea";

export type Comment = {
  id: string;
  tick: number;
  round: number;
  targetType: "player" | "point" | "area";
  targetPlayerIdx?: number;
  x?: number;
  y?: number;
  area?: string;
  text: string;
  author?: string;
  kind: CommentKind;
  createdAt: string;
};

export const COMMENT_KIND_LABEL: Record<CommentKind, string> = {
  note: "Note",
  positive: "Positive",
  mistake: "Mistake",
  caution: "Caution",
  idea: "Idea",
};

/** Maps onto the app's existing semantic CSS tokens (see .analysis-stat-value--*). */
export const COMMENT_KIND_COLOR: Record<CommentKind, string> = {
  note: "#9aa0a6",
  positive: "#6ee8a2",
  mistake: "#e05555",
  caution: "#f5a623",
  idea: "#7c8cf8",
};
