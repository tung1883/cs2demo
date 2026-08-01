import type { DemoData } from "../demoTypes";
import type { Drawing } from "../coach/coachTools";
import type { Comment } from "../comments/commentTypes";

export type PlaybackSettings = {
  playSpeed: number;
  showShots: boolean;
  showUtilities: boolean;
  showEffects: boolean;
  showPositions: boolean;
  showHeatmap: boolean;
  skipFreeze: boolean;
  autoAdvance: boolean;
  autoZoom: boolean;
  perfMode: boolean;
};

export type SessionEnvelope = {
  kind: "cs2-2d-demo-viewer-session";
  version: 1;
  createdAt: string;
  demoData: DemoData;
  comments: Comment[];
  coachDrawings: Record<number, Drawing[]>;
  playbackSettings: PlaybackSettings;
};

/** Minimal shape check — mirrors `validateDemoData`'s own checks without importing from main.ts (avoids a circular import). */
function looksLikeDemoData(x: unknown): x is DemoData {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.mapName === "string" &&
    typeof o.tickRate === "number" &&
    Number.isFinite(o.tickRate) &&
    typeof o.tickStep === "number" &&
    Number.isFinite(o.tickStep) &&
    Array.isArray(o.players) &&
    Array.isArray(o.frames)
  );
}

export function validateSessionEnvelope(x: unknown): x is SessionEnvelope {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.kind === "cs2-2d-demo-viewer-session" &&
    o.version === 1 &&
    looksLikeDemoData(o.demoData) &&
    Array.isArray(o.comments) &&
    typeof o.coachDrawings === "object" &&
    o.coachDrawings !== null &&
    typeof o.playbackSettings === "object" &&
    o.playbackSettings !== null
  );
}
