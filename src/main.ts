import type {
  BombDropTuple,
  BombPlantTuple,
  DemoData,
  Frame,
  FramePlayerRow,
  ShotTuple,
  UtilityTuple,
  GrenadePopTuple,
  FlashVictimTuple,
} from "./demoTypes";
import type { MapOverviewConfig } from "./mapOverview";
import { getMapOverview } from "./mapOverview";
import { lowerBoundBy } from "./utils/binarySearch";
import {
  computeSceneBounds,
  worldToCanvasBBox,
  type BoundingBox,
} from "./utils/coords";
import {
  overviewPixelToCanvas,
  worldToOverviewPixel,
} from "./utils/overviewTransform";
import { formatTime } from "./utils/time";
import { getPositionName } from "./mapPositions";
import { analyzeDemo, type DemoAnalysis, type HeatmapData } from "./analysis/engine";
import { computeEffectiveBBox, type ViewportMode } from "./utils/viewport";
import { CoachStore, type CoachTool } from "./coach/coachTools";
import { renderCoachOverlay } from "./coach/coachRenderer";
import { CoachInput } from "./coach/coachInput";
import { CommentStore } from "./comments/commentStore";
import { COMMENT_KIND_COLOR, COMMENT_KIND_LABEL, type Comment, type CommentKind } from "./comments/commentTypes";
import { downloadSessionEnvelope, importSessionFile } from "./session/sessionIO";
import type { SessionEnvelope } from "./session/sessionFormat";
import { loadRecentDemos, saveRecentDemo } from "./library/recentDemos";
import { buildDuelMatrix, buildOpeningDuelStats } from "./analysis/duels";
import { buildEconomyReport, summarizeByBuyType } from "./analysis/economy";
import {
  buildThrowStats,
  buildFlashStats,
  buildFlashImpact,
  buildDamageStats,
} from "./analysis/utilities";

const defaultBBox: BoundingBox = {
  minX: -2500,
  maxX: 2500,
  minY: -1500,
  maxY: 3500,
  pad: 200,
};

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const coachOverlay = document.getElementById("coach-overlay") as HTMLCanvasElement;
const coachCtx = coachOverlay.getContext("2d")!;
const scrub = document.getElementById("scrub") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const metaEl = document.getElementById("meta")!;
const exportProgressEl = document.getElementById("export-progress")!;
const exportProgressFill = document.getElementById(
  "export-progress-fill",
)! as HTMLDivElement;
const exportProgressLabel = document.getElementById("export-progress-label")!;
const timeReadout = document.getElementById("time-readout")!;
const bombHudEl = document.getElementById("bomb-hud")!;
const legendHelpEl = document.getElementById("legend-help")!;
const legendRosterEl = document.getElementById("legend-roster")!;
const errorEl = document.getElementById("error")!;
const showShotsEl = document.getElementById("show-shots") as HTMLInputElement;
const showUtilitiesEl = document.getElementById("show-utilities") as HTMLInputElement;
const showEffectsEl = document.getElementById("show-effects") as HTMLInputElement;
const showPositionsEl = document.getElementById("show-positions") as HTMLInputElement;
const showHeatmapEl = document.getElementById("show-heatmap") as HTMLInputElement;
const skipFreezeEl = document.getElementById("skip-freeze") as HTMLInputElement;
const autoAdvanceEl = document.getElementById("auto-advance") as HTMLInputElement;
const autoZoomEl = document.getElementById("auto-zoom") as HTMLInputElement;
const perfModeEl = document.getElementById("perf-mode") as HTMLInputElement;
const followModeEl = document.getElementById("follow-mode") as HTMLInputElement;
const followPlayerWrapEl = document.getElementById("follow-player-wrap") as HTMLLabelElement;
const followPlayerSelectEl = document.getElementById("follow-player-select") as HTMLSelectElement;
const prevRoundBtn = document.getElementById("prev-round") as HTMLButtonElement;
const nextRoundBtn = document.getElementById("next-round") as HTMLButtonElement;
const coachModeEl = document.getElementById("coach-mode") as HTMLInputElement;
const commentModeEl = document.getElementById("comment-mode") as HTMLInputElement;
const coachToolsEl = document.getElementById("coach-tools") as HTMLDivElement;
const coachColorEl = document.getElementById("coach-color") as HTMLInputElement;
const coachThicknessEl = document.getElementById("coach-thickness") as HTMLInputElement;
const coachUndoBtn = document.getElementById("coach-undo") as HTMLButtonElement;
const coachRedoBtn = document.getElementById("coach-redo") as HTMLButtonElement;
const coachClearBtn = document.getElementById("coach-clear") as HTMLButtonElement;
const toolBtns = document.querySelectorAll<HTMLButtonElement>(".tool-btn");
const heatmapPlayerSelectEl = document.getElementById("heatmap-player-select") as HTMLSelectElement;
const heatmapWeightSelectEl = document.getElementById("heatmap-weight-select") as HTMLSelectElement;
const heatmapFloorWrapEl = document.getElementById("heatmap-floor-wrap") as HTMLLabelElement;
const heatmapFloorSelectEl = document.getElementById("heatmap-floor-select") as HTMLSelectElement;
const demoUrlSelect = document.getElementById("demo-url-select") as HTMLSelectElement;
const demoLoadUrlBtn = document.getElementById("demo-load-url") as HTMLButtonElement;
const demoFileInput = document.getElementById("demo-file-input") as HTMLInputElement;
const sessionExportBtn = document.getElementById("session-export-btn") as HTMLButtonElement;
const sessionImportInput = document.getElementById("session-import-input") as HTMLInputElement;
const recentDemosWrapEl = document.getElementById("recent-demos-wrap") as HTMLDivElement;
const recentDemosListEl = document.getElementById("recent-demos-list") as HTMLDivElement;
const demoDemInput = document.getElementById("demo-dem-input") as HTMLInputElement;
const demoExportDemBtn = document.getElementById("demo-export-dem") as HTMLButtonElement;
const analysisContentEl = document.getElementById("analysis-content")!;
const duelsContentEl = document.getElementById("duels-content")!;
const economyContentEl = document.getElementById("economy-content")!;
const utilitiesContentEl = document.getElementById("utilities-content")!;
const commentsContentEl = document.getElementById("comments-content")!;
const speedBtns = document.querySelectorAll<HTMLButtonElement>(".speed-btn");
const tabBtns = document.querySelectorAll<HTMLButtonElement>(".legend-tab");
const panelLive = document.getElementById("panel-live")!;
const panelAnalysis = document.getElementById("panel-analysis")!;
const tabPanels: Record<string, HTMLElement> = {
  live: panelLive,
  analysis: panelAnalysis,
  duels: document.getElementById("panel-duels")!,
  economy: document.getElementById("panel-economy")!,
  utilities: document.getElementById("panel-utilities")!,
  comments: document.getElementById("panel-comments")!,
};
/** Per-tab (re)build hooks — populated by each feature as it's wired up. */
const tabOnActivate: Record<string, () => void> = {
  analysis: () => {
    if (analysis) buildAnalysisPanel();
  },
  duels: () => {
    if (data) buildDuelsPanel();
  },
  economy: () => {
    if (data) buildEconomyPanel();
  },
  utilities: () => {
    if (data) buildUtilitiesPanel();
  },
  comments: () => {
    buildCommentsPanel();
  },
};

let data: DemoData | null = null;
let frameIndex = 0;
let playing = false;
let raf = 0;
let lastFrameTime = 0;
let playAccum = 0;
let playSpeed = 1;
let analysis: DemoAnalysis | null = null;
let analysisPlayerIdx = -1;
let duelsIgnoreTraded = false;
let utilitiesSubTab: "throws" | "flashes" | "damage" = "throws";
let perfMode = false;
let skipFreezeOnRoundNav = false;
let autoAdvance = false;
let lastAutoAdvanceRound = -1;
const coachStore = new CoachStore();
const commentStore = new CommentStore();
let pendingComment: { tick: number; round: number; x: number; y: number } | null = null;

function stopPlayback(): void {
  playing = false;
  playBtn.setAttribute("aria-pressed", "false");
  playBtn.textContent = "Play";
  cancelAnimationFrame(raf);
  lastFrameTime = 0;
  playAccum = 0;
}

let bbox: BoundingBox = defaultBBox;
let viewportMode: ViewportMode = { kind: "fixed" };
/** Recomputed once per render() call; consulted by worldXYToCanvas/worldRadiusToCanvasPx/drawMapLayout. */
let activeViewportBBox: BoundingBox = defaultBBox;

/** Loaded square overview PNG + matching geometry from `src/mapOverview.ts` */
let overviewCfg: MapOverviewConfig | undefined;
let overviewImage: HTMLImageElement | null = null;

/**
 * Dropped-bomb marker icon: `public/bomb_c4.svg` (already a flat, solid-white
 * glyph on a transparent background) tinted to the marker's amber color once
 * at load. Falls back to the previous drawn diamond if the image is missing.
 */
let c4Icon: HTMLCanvasElement | null = null;
(() => {
  const img = new Image();
  img.onload = () => {
    if (!(img.naturalWidth > 0)) return;
    const SIZE = 32;
    const out = document.createElement("canvas");
    out.width = SIZE;
    out.height = SIZE;
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.drawImage(img, 0, 0, SIZE, SIZE);
    // Recolor the opaque glyph pixels to the marker's amber (keeps the SVG's alpha shape).
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = "#ffba48";
    octx.fillRect(0, 0, SIZE, SIZE);
    c4Icon = out;
  };
  img.onerror = () => {};
  img.src = "/bomb_c4.svg";
})();

function teamColor(team: number): string {
  if (team === 2) return "#e4a019";
  if (team === 3) return "#5b8fd8";
  return "#9aa0a6";
}

function parseFramePlayer(pl: FramePlayerRow): {
  idx: number;
  x: number;
  y: number;
  yaw: number;
  team: number;
  balance: number | undefined;
  gun: string | undefined;
  utils: string | undefined;
  hasBomb: boolean;
  /** World height — `undefined` on rows exported before floor support (length < 10). */
  z: number | undefined;
} {
  const idx = Number(pl[0]);
  const x = Number(pl[1]);
  const y = Number(pl[2]);
  const yaw = Number(pl[3]);
  const team = Number(pl[4]);
  let balance: number | undefined;
  let gun: string | undefined;
  let utils: string | undefined;
  let hasBomb = false;
  let z: number | undefined;
  if (pl.length >= 8) {
    const bRaw = pl[5];
    const b =
      typeof bRaw === "number" && Number.isFinite(bRaw)
        ? bRaw
        : Number(bRaw);
    balance = Number.isFinite(b) && b >= 0 ? b : undefined;
    const g = typeof pl[6] === "string" ? pl[6] : String(pl[6] ?? "");
    gun = g.trim() ? g : undefined;
    const u = typeof pl[7] === "string" ? pl[7] : String(pl[7] ?? "");
    utils = u.trim() ? u : undefined;
  }
  if (pl.length >= 9 && Number(pl[8]) === 1) hasBomb = true;
  if (pl.length >= 10) {
    const zRaw = Number(pl[9]);
    z = Number.isFinite(zRaw) ? zRaw : undefined;
  }
  return { idx, x, y, yaw, team, balance, gun, utils, hasBomb, z };
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function latestBombPlantAtOrBefore(tick: number): BombPlantTuple | undefined {
  const plants = data?.bombPlants;
  if (!plants?.length) return undefined;
  const i = lowerBoundBy(plants, tick + 1, (p) => p[0]) - 1;
  if (i < 0) return undefined;
  return plants[i];
}

function nextBombEndTickAfter(plantTick: number): number | undefined {
  const ends = data?.bombEnds;
  if (!ends?.length) return undefined;
  const i = lowerBoundBy(ends, plantTick + 1, (e) => e[0]);
  if (i >= ends.length) return undefined;
  return ends[i][0];
}

/** Latest plant still armed: 40s fuse cap; ends sooner on demo explode/defuse. */
function activePlantedBombState(
  frameTick: number,
): { plant: BombPlantTuple; endTick: number } | null {
  if (!data) return null;
  const plant = latestBombPlantAtOrBefore(frameTick);
  if (!plant) return null;
  const fuseEndTick = plant[0] + Math.round(data.tickRate * BOMB_FUSE_SEC);
  const eventEnd = nextBombEndTickAfter(plant[0]);
  const endTick =
    eventEnd !== undefined ? Math.min(fuseEndTick, eventEnd) : fuseEndTick;
  if (endTick <= frameTick) return null;
  return { plant, endTick };
}

/** Bomb on ground after drop until pickup or plant (tick lists from demo events). */
function activeDroppedBomb(frameTick: number): BombDropTuple | null {
  if (!data?.bombDrops?.length) return null;
  const drops = data.bombDrops;
  const pickups = data.bombPickupTicks ?? [];
  const plants = data.bombPlants ?? [];
  for (let i = drops.length - 1; i >= 0; i--) {
    const row = drops[i];
    const dt = row[0];
    if (dt > frameTick) continue;
    const clearedByPickup = pickups.some((p) => p > dt && p <= frameTick);
    const clearedByPlant = plants.some((p) => p[0] > dt && p[0] <= frameTick);
    if (clearedByPickup || clearedByPlant) continue;
    return row;
  }
  return null;
}

function bombCarrierLabel(frame: Frame): string | null {
  const tick = frame[0];
  if (activePlantedBombState(tick)) return null;
  if (activeDroppedBomb(tick)) return null;
  const [, , players] = frame;
  for (const pl of players) {
    const p = parseFramePlayer(pl);
    if (p.hasBomb) {
      return data?.players[p.idx]?.name ?? `#${p.idx}`;
    }
  }
  return null;
}

function updateBombHud(frame: Frame | undefined): void {
  if (!data || !frame) {
    bombHudEl.textContent = "";
    return;
  }
  const tick = frame[0];
  const planted = activePlantedBombState(tick);
  if (planted) {
    const sec = (planted.endTick - tick) / data.tickRate;
    const site = planted.plant[3];
    const siteBit = site >= 0 ? ` · site ${site}` : "";
    bombHudEl.textContent = `Bomb planted · ${sec.toFixed(1)}s${siteBit}`;
    return;
  }
  if (activeDroppedBomb(tick)) {
    bombHudEl.textContent = "Bomb dropped";
    return;
  }
  const carrier = bombCarrierLabel(frame);
  bombHudEl.textContent = carrier ? `Carrier: ${carrier}` : "";
}

function displayGunLabel(slug: string | undefined): string {
  if (!slug) return "—";
  const s = slug.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function updateLegendRoster(frame: Frame | undefined): void {
  if (!legendRosterEl) return;
  if (!data || !frame) {
    legendRosterEl.innerHTML = "";
    return;
  }
  const [, , players] = frame;
  const parsed = players.map(parseFramePlayer);

  let sumT = 0;
  let sumCt = 0;
  let anyT = false;
  let anyCt = false;
  for (const p of parsed) {
    if (p.balance === undefined) continue;
    if (p.team === 2) {
      sumT += p.balance;
      anyT = true;
    }
    if (p.team === 3) {
      sumCt += p.balance;
      anyCt = true;
    }
  }

  const banner = `<div class="team-money-banner"><span class="banner-t">T<strong>${anyT ? escapeHtml(formatMoney(sumT)) : "—"}</strong></span><span class="banner-ct">CT<strong>${anyCt ? escapeHtml(formatMoney(sumCt)) : "—"}</strong></span></div>`;

  const byTeam = new Map<number, typeof parsed>();
  for (const p of parsed) {
    const arr = byTeam.get(p.team) ?? [];
    arr.push(p);
    byTeam.set(p.team, arr);
  }

  const parts: string[] = [banner];
  for (const team of [...byTeam.keys()].sort()) {
    const label = team === 2 ? "T" : team === 3 ? "CT" : `Team ${team}`;
    parts.push(`<h2>${escapeHtml(label)}</h2><ul>`);
    for (const p of (byTeam.get(team) ?? []).sort((a, b) => a.idx - b.idx)) {
      const name = data.players[p.idx]?.name ?? `#${p.idx}`;
      const col = teamColor(team);
      const cash =
        p.balance !== undefined ? formatMoney(p.balance) : "—";
      const gunEsc = escapeHtml(displayGunLabel(p.gun));
      const utilsEsc = p.utils ? escapeHtml(p.utils) : "—";
      parts.push(
        `<li class="roster-line"><div class="roster-top"><span class="swatch" style="background:${col}"></span><span class="roster-name">${escapeHtml(name)}</span><span class="roster-cash">${escapeHtml(cash)}</span></div><div class="roster-loadout"><span class="gun">${gunEsc}</span> · <span class="utils">${utilsEsc}</span></div></li>`,
      );
    }
    parts.push("</ul>");
  }
  legendRosterEl.innerHTML = parts.join("");
}

function usingOverview(): boolean {
  return !!(overviewCfg && overviewImage);
}

/**
 * Overview-image source crop rect (in overview-pixel space) for the active
 * viewport. Fixed mode returns the full image — identical to the pre-zoom
 * behavior. Zoomed modes crop to `activeViewportBBox`'s world-space window.
 */
function getOverviewCropRect(cfg: MapOverviewConfig): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  const n = cfg.overviewPx || 1024;
  if (viewportMode.kind === "fixed") {
    return { sx: 0, sy: 0, sw: n, sh: n };
  }
  const b = activeViewportBBox;
  const a = worldToOverviewPixel(b.minX - b.pad, b.maxY + b.pad, cfg);
  const c = worldToOverviewPixel(b.maxX + b.pad, b.minY - b.pad, cfg);
  const sx = Math.min(a.px, c.px);
  const sy = Math.min(a.py, c.py);
  const sw = Math.max(Math.abs(c.px - a.px), 1);
  const sh = Math.max(Math.abs(c.py - a.py), 1);
  return { sx, sy, sw, sh };
}

function worldXYToCanvas(wx: number, wy: number): { x: number; y: number } {
  if (usingOverview()) {
    const cfg = overviewCfg!;
    const { px, py } = worldToOverviewPixel(wx, wy, cfg);
    const { sx, sy, sw, sh } = getOverviewCropRect(cfg);
    const cw = canvas.width;
    const ch = canvas.height;
    const side = Math.min(cw, ch);
    const ox = (cw - side) / 2;
    const oy = (ch - side) / 2;
    return { x: ox + ((px - sx) / sw) * side, y: oy + ((py - sy) / sh) * side };
  }
  return worldToCanvasBBox(wx, wy, activeViewportBBox, canvas.width, canvas.height);
}

/** Inverse of `worldXYToCanvas` — canvas pixel → world XY, for coach/comment click placement. */
function canvasToWorldXY(cx: number, cy: number): { x: number; y: number } {
  if (usingOverview()) {
    const cfg = overviewCfg!;
    const { sx, sy, sw, sh } = getOverviewCropRect(cfg);
    const cw = canvas.width;
    const ch = canvas.height;
    const side = Math.min(cw, ch);
    const ox = (cw - side) / 2;
    const oy = (ch - side) / 2;
    const px = sx + ((cx - ox) / side) * sw;
    const py = sy + ((cy - oy) / side) * sh;
    return { x: px * cfg.scale + cfg.posX, y: cfg.posY - py * cfg.scale };
  }
  const b = activeViewportBBox;
  const spanX = b.maxX - b.minX + b.pad * 2 || 1;
  const spanY = b.maxY - b.minY + b.pad * 2 || 1;
  const nx = cx / canvas.width;
  const ny = (canvas.height - cy) / canvas.height;
  return { x: nx * spanX + b.minX - b.pad, y: ny * spanY + b.minY - b.pad };
}

/** Approximate canvas pixels per world unit for circular FX. */
function worldRadiusToCanvasPx(rWorld: number): number {
  const cw = canvas.width;
  const ch = canvas.height;
  if (usingOverview() && overviewCfg) {
    const side = Math.min(cw, ch);
    const { sw, sh } = getOverviewCropRect(overviewCfg);
    return (rWorld / overviewCfg.scale) * (side / ((sw + sh) / 2));
  }
  const sx = activeViewportBBox.maxX - activeViewportBBox.minX + 2 * activeViewportBBox.pad;
  const sy = activeViewportBBox.maxY - activeViewportBBox.minY + 2 * activeViewportBBox.pad;
  const pxPerWu = 0.5 * (cw / sx + ch / sy);
  return rWorld * pxPerWu;
}

/** Latest sampled yaw at or before tick (fallback when JSON has no weapon_fire user_yaw). */
function yawFromFrames(tick: number, playerIdx: number): number | undefined {
  if (!data?.frames.length) return undefined;
  const frames = data.frames;
  const i = lowerBoundBy(frames, tick + 1, (f) => f[0]) - 1;
  if (i < 0) return undefined;
  for (const pl of frames[i][2]) {
    if (pl[0] === playerIdx) {
      const y = pl[3];
      const yn = typeof y === "number" ? y : Number(y);
      return Number.isFinite(yn) ? yn : undefined;
    }
  }
  return undefined;
}

/**
 * Yaw/pitch from weapon_fire JSON when present ([5]=yaw, [6]=pitch).
 */
function anglesFromFireTuple(
  s: ShotTuple | UtilityTuple,
  tick: number,
  playerIdx: number,
): { yaw?: number; pitch?: number } {
  let yaw: number | undefined;
  let pitch: number | undefined;
  if (s.length >= 6 && typeof s[5] === "number" && Number.isFinite(s[5])) {
    yaw = s[5];
  }
  if (s.length >= 7 && typeof s[6] === "number" && Number.isFinite(s[6])) {
    pitch = s[6];
  }
  if (yaw === undefined) yaw = yawFromFrames(tick, playerIdx);
  return { yaw, pitch };
}

/** Horizontal aim in world X/Y from demo degrees — matches Source AngleVectors (cp·cos(yaw), cp·sin(yaw)). */
function aimForwardWorldXY(yawDeg: number, pitchDeg?: number): { dx: number; dy: number } {
  const yawRad = (yawDeg * Math.PI) / 180;
  const cp =
    pitchDeg !== undefined && Number.isFinite(pitchDeg)
      ? Math.cos((pitchDeg * Math.PI) / 180)
      : 1;
  return { dx: Math.cos(yawRad) * cp, dy: Math.sin(yawRad) * cp };
}

/**
 * Smoke marker: white disk shows approximate seconds remaining until we hide it.
 * Lifetime matches the viewer FX window (`SMOKE_LIFETIME_SEC`), not necessarily exact game duration.
 */
const SMOKE_LIFETIME_SEC = 17;
const SMOKE_MARKER_RADIUS_WORLD_U = 144;

/** Round timer from first sampled tick of each round (competitive ≈ 1:55). */
const ROUND_CLOCK_SEC = 115;
/** Planted C4 fuse length shown in viewer (capped; early explode/defuse still ends earlier). */
const BOMB_FUSE_SEC = 40;

function utilityRgb(short?: string): [number, number, number] {
  switch (short) {
    case "flashbang":
      return [255, 251, 168];
    case "smokegrenade":
      return [176, 198, 224];
    case "hegrenade":
      return [255, 118, 96];
    case "molotov":
    case "incgrenade":
      return [255, 146, 52];
    case "decoy":
      return [158, 236, 178];
    default:
      return [220, 224, 248];
  }
}

/**
 * Beam along aim direction: step in world units then map both endpoints to canvas so
 * bbox letterboxing does not skew bearing (previous canvas-space trig was wrong when spanX≠spanY).
 */
function drawDirectedLightRay(
  wx: number,
  wy: number,
  yawDeg: number | undefined,
  pitchDeg: number | undefined,
  strength: number,
  mode: "gun" | "utility",
  utilityShort?: string,
): void {
  const start = worldXYToCanvas(wx, wy);

  if (yawDeg === undefined || !Number.isFinite(yawDeg)) {
    const r = (mode === "gun" ? 2 : 4) * Math.max(0.35, strength);
    const [r255, g255, b255] =
      mode === "gun" ? ([255, 255, 255] as const) : utilityRgb(utilityShort);
    ctx.save();
    ctx.fillStyle =
      mode === "gun"
        ? `rgba(255,255,255,${0.14 * strength})`
        : `rgba(${r255},${g255},${b255},${0.42 * strength})`;
    ctx.shadowBlur = mode === "gun" ? 2 * strength : 14 * strength;
    ctx.shadowColor =
      mode === "gun"
        ? `rgba(255,255,255,${0.14 * strength})`
        : `rgba(${r255},${g255},${b255},${0.65 * strength})`;
    ctx.beginPath();
    ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const fwd = aimForwardWorldXY(yawDeg, pitchDeg);
  const worldLen =
    mode === "gun"
      ? 260 + 160 * Math.max(0.08, strength)
      : 340 + 300 * Math.max(0.08, strength);
  const endPt = worldXYToCanvas(
    wx + fwd.dx * worldLen,
    wy + fwd.dy * worldLen,
  );
  const sx = start.x;
  const sy = start.y;
  const ex = endPt.x;
  const ey = endPt.y;

  const [tr, tg, tb] =
    mode === "gun" ? ([255, 255, 255] as const) : utilityRgb(utilityShort);

  const beamPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
  };

  ctx.save();
  ctx.lineCap = "round";

  if (mode === "gun") {
    ctx.strokeStyle = `rgba(248,250,253,${0.11 * strength})`;
    ctx.lineWidth = 1.15 + 0.45 * strength;
    ctx.shadowBlur = 2;
    ctx.shadowColor = `rgba(255,255,255,${0.12 * strength})`;
    beamPath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${0.26 * strength})`;
    ctx.lineWidth = 0.75;
    beamPath();
    ctx.stroke();
  } else {
    ctx.strokeStyle = `rgba(${tr},${tg},${tb},${0.38 * strength})`;
    ctx.lineWidth = 8 + 6 * strength;
    ctx.shadowBlur = 16 + 8 * strength;
    ctx.shadowColor = `rgba(${tr},${tg},${tb},${0.72 * strength})`;
    beamPath();
    ctx.stroke();

    ctx.shadowBlur = 10;
    ctx.lineWidth = 3 + 1.5 * strength;
    ctx.strokeStyle = `rgba(${Math.min(255, tr + 35)},${Math.min(255, tg + 35)},${Math.min(255, tb + 35)},${0.88 * strength})`;
    beamPath();
    ctx.stroke();
  }

  ctx.restore();
}

function drawMapLayout(): void {
  const cw = canvas.width;
  const ch = canvas.height;

  if (usingOverview() && overviewCfg && overviewImage) {
    ctx.fillStyle = "#0a0c0f";
    ctx.fillRect(0, 0, cw, ch);
    const ref = overviewPixelToCanvas(0, 0, overviewCfg, cw, ch);
    const crop = getOverviewCropRect(overviewCfg);
    ctx.drawImage(
      overviewImage,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      ref.ox,
      ref.oy,
      ref.side,
      ref.side,
    );
    ctx.strokeStyle = "rgba(61,220,151,0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(ref.ox + 1, ref.oy + 1, ref.side - 2, ref.side - 2);
    if (data) {
      ctx.fillStyle = "rgba(10,12,15,0.72)";
      ctx.fillRect(8, 8, 280, 44);
      ctx.fillStyle = "rgba(230,235,245,0.9)";
      ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
      ctx.fillText(data.mapName.toUpperCase() + " · overview PNG", 16, 26);
      ctx.font = "10px Segoe UI, system-ui, sans-serif";
      ctx.fillStyle = "rgba(200,206,220,0.75)";
      ctx.fillText("Geometry from resource/overviews/<map>.txt · PNG in public/map or public/maps", 16, 42);
    }
    return;
  }

  const g = ctx.createLinearGradient(0, 0, cw, ch);
  g.addColorStop(0, "#151a20");
  g.addColorStop(1, "#0e1116");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);

  const grid = 12;
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= grid; i++) {
    const gx = (i / grid) * cw;
    const gy = (i / grid) * ch;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, ch);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(cw, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(61,220,151,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, cw - 2, ch - 2);

  if (data) {
    ctx.fillStyle = "rgba(230,235,245,0.55)";
    ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
    ctx.fillText(data.mapName.toUpperCase(), 12, 22);
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.fillStyle = "rgba(200,206,220,0.45)";
    ctx.fillText("World X/Y · auto-fit to players + weapon_fire beams", 12, 40);
    const b = bbox;
    ctx.fillText(
      `Bounds ≈ X[${Math.round(b.minX - b.pad)}, ${Math.round(b.maxX + b.pad)}]  Y[${Math.round(b.minY - b.pad)}, ${Math.round(b.maxY + b.pad)}]`,
      12,
      56,
    );

    const cfgHint = overviewCfg
      ? `overview: add PNG at public/map(s)/${data.mapName}.png or ${data.mapName}_radar.png`
      : "";
    if (cfgHint) {
      ctx.fillStyle = "rgba(255,186,92,0.55)";
      ctx.fillText(cfgHint, 12, 72);
    }
  }
}

function beamFadeWindowTicks(): number {
  if (!data) return 0;
  return Math.max(24, Math.ceil(data.tickRate * 0.35));
}

function drawGunshots(frameTick: number): void {
  if (!data?.shots?.length || !showShotsEl.checked) return;
  const win = beamFadeWindowTicks();
  const shots = data.shots;
  const lo = lowerBoundBy(shots, frameTick - win, (s) => s[0]);

  for (let i = lo; i < shots.length; i++) {
    const s = shots[i] as ShotTuple;
    const tick = s[0];
    if (tick > frameTick) break;
    const age = frameTick - tick;
    const strength = Math.max(0, 1 - age / win);
    if (strength <= 0) continue;
    const wx = s[1];
    const wy = s[2];
    const idx = s[3];
    const { yaw, pitch } = anglesFromFireTuple(s, tick, idx);
    drawDirectedLightRay(wx, wy, yaw, pitch, strength, "gun");
  }
}

function drawUtilityThrows(frameTick: number): void {
  if (!data?.utilities?.length || !showUtilitiesEl.checked) return;
  const win = beamFadeWindowTicks();
  const utilities = data.utilities;
  const lo = lowerBoundBy(utilities, frameTick - win, (s) => s[0]);

  for (let i = lo; i < utilities.length; i++) {
    const s = utilities[i] as UtilityTuple;
    const tick = s[0];
    if (tick > frameTick) break;
    const age = frameTick - tick;
    const strength = Math.max(0, 1 - age / win);
    if (strength <= 0) continue;
    const wx = s[1];
    const wy = s[2];
    const idx = s[3];
    const slug = s[4];
    const { yaw, pitch } = anglesFromFireTuple(s, tick, idx);
    drawDirectedLightRay(wx, wy, yaw, pitch, strength, "utility", slug);
  }
}

function drawSmokeCountdownDisk(
  cx: number,
  cy: number,
  radPx: number,
  remainingSec: number,
): void {
  const secLeft = Math.max(0, remainingSec);
  const label = String(Math.ceil(secLeft - 1e-9));

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.strokeStyle = "rgba(32,36,46,0.92)";
  ctx.lineWidth = Math.max(1.5, radPx * 0.06);
  ctx.beginPath();
  ctx.arc(cx, cy, radPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const fs = Math.max(11, Math.min(28, radPx * 0.52));
  ctx.font = `700 ${fs}px Segoe UI, system-ui, sans-serif`;
  ctx.fillStyle = "#161a22";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

/** Performance mode: skip radial-gradient FX for HE/flash/molotov in favor of a flat disk. */
function drawFlatCircle(cx: number, cy: number, r: number, color: string, alpha: number): void {
  ctx.save();
  ctx.fillStyle = color.replace("ALPHA", alpha.toFixed(2));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGrenadeFxLayer(frameTick: number): void {
  if (!data || !showEffectsEl.checked) return;
  const tr = data.tickRate;

  function sweep(
    pops: readonly GrenadePopTuple[] | undefined,
    winTicks: number,
    draw: (wx: number, wy: number, u: number, age: number, detTick: number) => void,
  ): void {
    if (!pops?.length) return;
    const lo = lowerBoundBy(pops, frameTick - winTicks, (p) => p[0]);
    for (let i = lo; i < pops.length; i++) {
      const row = pops[i];
      const t = row[0];
      if (t > frameTick) break;
      const age = frameTick - t;
      const u = Math.max(0, 1 - age / winTicks);
      if (u <= 0) continue;
      draw(row[1], row[2], u, age, t);
    }
  }

  const smokeWinTicks = Math.ceil(tr * SMOKE_LIFETIME_SEC);
  sweep(data.smokePops, smokeWinTicks, (wx, wy, _u, age, _detTick) => {
    const c = worldXYToCanvas(wx, wy);
    const radPx = worldRadiusToCanvasPx(SMOKE_MARKER_RADIUS_WORLD_U);
    const remainingTicks = smokeWinTicks - age;
    const remainingSec = remainingTicks / tr;
    drawSmokeCountdownDisk(c.x, c.y, radPx, remainingSec);
  });

  sweep(data.hePops, Math.ceil(tr * 0.65), (wx, wy, u, _age, _detTick) => {
    const c = worldXYToCanvas(wx, wy);
    const radPx = worldRadiusToCanvasPx(78) * (0.55 + 0.45 * u);
    if (perfMode) {
      drawFlatCircle(c.x, c.y, radPx, "rgba(255,115,48,ALPHA)", 0.22 * u);
      return;
    }
    ctx.save();
    ctx.strokeStyle = `rgba(255,150,72,${0.42 * u})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,115,48,${0.08 * u})`;
    ctx.fill();
    ctx.restore();
  });

  sweep(data.flashPops, Math.ceil(tr * 0.42), (wx, wy, u, _age, _detTick) => {
    const c = worldXYToCanvas(wx, wy);
    const radPx = worldRadiusToCanvasPx(42) * (0.5 + 0.5 * u);
    if (perfMode) {
      drawFlatCircle(c.x, c.y, radPx * 1.35, "rgba(255,238,160,ALPHA)", 0.22 * u);
      return;
    }
    ctx.save();
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radPx * 1.35);
    g.addColorStop(0, `rgba(255,252,230,${0.32 * u})`);
    g.addColorStop(0.35, `rgba(255,238,160,${0.12 * u})`);
    g.addColorStop(1, "rgba(255,220,120,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radPx * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  sweep(data.molotovPools, Math.ceil(tr * 7.5), (wx, wy, u, _age, _detTick) => {
    const c = worldXYToCanvas(wx, wy);
    const radPx = worldRadiusToCanvasPx(68) * (0.65 + 0.35 * Math.sqrt(u));
    if (perfMode) {
      drawFlatCircle(c.x, c.y, radPx, "rgba(255,82,28,ALPHA)", 0.15);
      return;
    }
    ctx.save();
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radPx);
    g.addColorStop(0, `rgba(255,132,48,${0.16 * u})`);
    g.addColorStop(0.55, `rgba(255,82,28,${0.1 * u})`);
    g.addColorStop(1, "rgba(180,40,12,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawFlashVictimHalos(frame: Frame | undefined): void {
  if (!data?.flashVictims?.length || !showEffectsEl.checked || !frame) return;
  const ftick = frame[0];
  const win = Math.ceil(data.tickRate * 4.8);
  const victims = data.flashVictims;
  const lo = lowerBoundBy(victims, ftick - win, (v) => v[0]);

  const active = new Map<number, number>();
  for (let i = lo; i < victims.length; i++) {
    const row = victims[i] as FlashVictimTuple;
    const [tFlash, idx, amt] = row;
    if (tFlash > ftick) break;
    if (ftick > tFlash + win) continue;
    const fade =
      Math.max(0, 1 - (ftick - tFlash) / win) *
      Math.min(1, Math.max(0, amt));
    active.set(idx, Math.max(active.get(idx) ?? 0, fade));
  }
  if (active.size === 0) return;

  const [, , players] = frame;
  for (const pl of players) {
    const idx = Number(pl[0]);
    const x = Number(pl[1]);
    const y = Number(pl[2]);
    const fade = active.get(idx);
    if (fade === undefined || fade <= 0.03) continue;
    const { x: cx, y: cy } = worldXYToCanvas(x, y);
    ctx.save();
    ctx.strokeStyle = `rgba(255,248,190,${0.28 + 0.42 * fade})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 11 + 7 * fade, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,252,210,${0.06 + 0.08 * fade})`;
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayers(frame: Frame | undefined): void {
  const cw = canvas.width;
  const ch = canvas.height;

  if (!frame) return;
  const [, , players] = frame;

  let arrowWorldLen = 150;
  if (usingOverview() && overviewCfg) {
    const side = Math.min(cw, ch);
    arrowWorldLen = overviewCfg.scale * side * 0.028;
  } else {
    const sx = bbox.maxX - bbox.minX + 2 * bbox.pad;
    const sy = bbox.maxY - bbox.minY + 2 * bbox.pad;
    arrowWorldLen = Math.max(sx, sy) * 0.024;
  }

  const ftick = frame[0];
  const plantedBomb = activePlantedBombState(ftick);
  const droppedBomb = activeDroppedBomb(ftick);

  for (const pl of players) {
    const { idx, x, y, yaw, team, hasBomb } = parseFramePlayer(pl);
    const { x: cx, y: cy } = worldXYToCanvas(x, y);
    const col = teamColor(team);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    if (hasBomb && !plantedBomb && !droppedBomb) {
      ctx.save();
      ctx.strokeStyle = "rgba(94,255,140,0.88)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const fwd = aimForwardWorldXY(yaw, undefined);
    const tip = worldXYToCanvas(
      x + fwd.dx * arrowWorldLen,
      y + fwd.dy * arrowWorldLen,
    );
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    if (data) {
      const name = data.players[idx]?.name ?? `#${idx}`;
      ctx.font = "bold 11px Segoe UI, system-ui, sans-serif";
      ctx.fillStyle = "rgba(232,234,237,0.92)";
      ctx.fillText(name, cx + 9, cy + 4);

      if (showPositionsEl.checked) {
        const posName = getPositionName(data.mapName, x, y);
        if (posName) {
          ctx.font = "9px Segoe UI, system-ui, sans-serif";
          ctx.fillStyle = "rgba(160,185,220,0.78)";
          ctx.fillText(posName, cx + 9, cy + 15);
        }
      }
    }
  }
}

function drawBombLayer(frame: Frame | undefined): void {
  if (!data || !frame) return;
  const tick = frame[0];
  const planted = activePlantedBombState(tick);
  if (planted) {
    const [, wx, wy] = planted.plant;
    const c = worldXYToCanvas(wx, wy);
    const sec = (planted.endTick - tick) / data.tickRate;
    ctx.save();
    ctx.fillStyle = "rgba(235,60,60,0.92)";
    ctx.strokeStyle = "rgba(26,8,8,0.95)";
    ctx.lineWidth = 2;
    const r = 9;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,238,238,0.96)";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.max(0, sec).toFixed(1)}s`, c.x + r + 6, c.y);
    ctx.restore();
    return;
  }

  const dropped = activeDroppedBomb(tick);
  if (!dropped) return;
  const [, dx, dy] = dropped;
  const c = worldXYToCanvas(dx, dy);
  ctx.save();
  if (c4Icon) {
    const s = 18;
    ctx.drawImage(c4Icon, c.x - s / 2, c.y - s / 2, s, s);
  } else {
    const s = 10;
    ctx.fillStyle = "rgba(255,186,72,0.95)";
    ctx.strokeStyle = "rgba(42,28,8,0.92)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - s);
    ctx.lineTo(c.x + s, c.y);
    ctx.lineTo(c.x, c.y + s);
    ctx.lineTo(c.x - s, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeatmapOverlay(): void {
  if (!showHeatmapEl.checked || !analysis) return;
  const pidx = analysisPlayerIdx;
  const floor = heatmapFloorSelectEl.value;
  let hm: HeatmapData | undefined;
  if ((floor === "Upper" || floor === "Lower") && pidx >= 0) {
    hm = analysis.heatmapsByFloor.get(pidx)?.get(floor);
  } else {
    const source = heatmapWeightSelectEl.value === "coverage" ? analysis.heatmapsCoverage : analysis.heatmapsDwell;
    hm = pidx >= 0 ? source.get(pidx) : undefined;
  }
  if (!hm) return;

  const W = hm.gridW;
  const H = hm.gridH;
  const spanX = hm.worldMaxX - hm.worldMinX || 1;
  const spanY = hm.worldMaxY - hm.worldMinY || 1;
  const cellRx = (spanX / W) * 0.6;
  const cellRy = (spanY / H) * 0.6;

  ctx.save();
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const d = hm.grid[gy * W + gx];
      if (d < 0.03) continue;
      const wx = hm.worldMinX + (gx + 0.5) * (spanX / W);
      const wy = hm.worldMinY + (gy + 0.5) * (spanY / H);
      const c = worldXYToCanvas(wx, wy);
      const cxPx = worldRadiusToCanvasPx(cellRx);
      const cyPx = worldRadiusToCanvasPx(cellRy);
      const r = Math.max(cxPx, cyPx, 2);

      const hue = (1 - d) * 240;
      const alpha = 0.12 + d * 0.45;
      ctx.fillStyle = `hsla(${hue},90%,60%,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFrame(frame: Frame | undefined): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawMapLayout();
  drawHeatmapOverlay();
  const tick = frame?.[0] ?? 0;
  drawUtilityThrows(tick);
  drawGunshots(tick);
  drawGrenadeFxLayer(tick);
  drawPlayers(frame);
  drawBombLayer(frame);
  drawFlashVictimHalos(frame);
}

type HudRoundPhase =
  | { kind: "timeline_pregame" }
  | { kind: "timeline_live"; round: number; liveStart: number }
  /** Buy period: after previous round HUD ended, before `round_freeze_end` for this round — not post-win delay */
  | { kind: "timeline_freeze"; round: number; liveStart: number }
  | { kind: "timeline_between" }
  | { kind: "legacy" };

/** Live HUD countdown vs freeze vs post-round gap (`total_rounds_played` jumps during freeze). */
function hudRoundPhase(frameTick: number, frameRound: number): HudRoundPhase {
  const starts = data?.roundClockStarts;
  const ends = data?.roundEndsHud;
  if (!starts?.length || !ends?.length) return { kind: "legacy" };

  const startsSorted = [...starts]
    .map(([t, r]) => ({ tick: t, round: Math.trunc(Number(r)) }))
    .sort((a, b) => a.tick - b.tick);

  const endByRound = new Map<number, number>();
  for (const [t, r] of ends) {
    const rr = Math.trunc(Number(r));
    const prev = endByRound.get(rr);
    if (prev === undefined || t > prev) endByRound.set(rr, t);
  }

  const rnd = Math.trunc(Number(frameRound));

  if (frameTick < startsSorted[0].tick) {
    return { kind: "timeline_pregame" };
  }

  for (let i = 0; i < startsSorted.length; i++) {
    const { tick: ls, round: R } = startsSorted[i];
    const next = startsSorted[i + 1];
    const nextLs = next ? next.tick : Infinity;
    const explicitEnd = endByRound.get(R);
    const liveEnd = explicitEnd ?? nextLs;

    if (frameTick < ls) continue;

    if (frameTick < liveEnd) {
      return { kind: "timeline_live", round: R, liveStart: ls };
    }

    if (next && frameTick < nextLs) {
      // Same demo-tick gap as post-win delay, but freeze shows new `total_rounds_played` early.
      if (Number.isFinite(rnd) && rnd >= next.round) {
        return {
          kind: "timeline_freeze",
          round: next.round,
          liveStart: nextLs,
        };
      }
      return { kind: "timeline_between" };
    }
  }

  return { kind: "timeline_between" };
}

/** Demo tick where live clock begins for `roundNum` (`round_freeze_end`, paired in export); else undefined (viewer falls back). */
function roundClockStartTickForRound(roundNum: number): number | undefined {
  const rows = data?.roundClockStarts;
  if (!rows?.length) return undefined;
  const target = Math.trunc(roundNum);
  for (const [tick, r] of rows) {
    if (Math.trunc(Number(r)) === target) return tick;
  }
  return undefined;
}

/** Demo tick at first exported frame of the round containing `frames[idx]` (fallback when no `roundClockStarts`). */
function roundStartTickForFrameIndex(idx: number): number {
  if (!data?.frames.length) return 0;
  const frames = data.frames;
  const r = frames[idx][1];
  let i = idx;
  while (i > 0 && frames[i - 1][1] === r) i--;
  return frames[i][0];
}

function roundRemainingSeconds(frameIdx: number): number {
  if (!data?.frames.length) return ROUND_CLOCK_SEC;
  const frame = data.frames[frameIdx];
  const T = frame[0];
  const phase = hudRoundPhase(T, frame[1]);

  if (phase.kind === "timeline_between") return 0;
  if (phase.kind === "timeline_pregame") return ROUND_CLOCK_SEC;
  if (phase.kind === "timeline_freeze") return ROUND_CLOCK_SEC;

  if (phase.kind === "timeline_live") {
    const elapsed = (T - phase.liveStart) / data.tickRate;
    return Math.max(0, ROUND_CLOCK_SEC - elapsed);
  }

  const roundNum = frame[1];
  const clockTick = roundClockStartTickForRound(roundNum);
  const startTick =
    clockTick !== undefined
      ? clockTick
      : roundStartTickForFrameIndex(frameIdx);
  const elapsed = Math.max(0, (T - startTick) / data.tickRate);
  return Math.max(0, ROUND_CLOCK_SEC - elapsed);
}

function updateReadout(): void {
  if (!data || !data.frames.length) return;
  const frame = data.frames[frameIndex];
  const tick = frame[0];
  const round = frame[1];
  const phase = hudRoundPhase(tick, round);
  const displayRound =
    phase.kind === "timeline_live" || phase.kind === "timeline_freeze"
      ? phase.round
      : round;
  const betweenNote =
    phase.kind === "timeline_between"
      ? " · between rounds"
      : phase.kind === "timeline_freeze"
        ? " · freeze"
        : "";
  const t = tick / data.tickRate;
  const roundLeft = roundRemainingSeconds(frameIndex);
  // total_rounds_played is 0-indexed (rounds completed so far); humans count rounds from 1.
  timeReadout.textContent = `Round ${displayRound + 1} · ${formatTime(roundLeft)} left${betweenNote} · tick ${tick} · demo ${formatTime(t)}`;
}

function render(): void {
  if (!data) {
    ctx.fillStyle = "#0e1116";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(200,206,220,0.58)";
    ctx.font = "14px Segoe UI, system-ui, sans-serif";
    ctx.fillText(
      "Pick a .dem (Export & load with npm run dev), bundled demo + Load, or open JSON.",
      22,
      36,
    );
    timeReadout.textContent = "";
    bombHudEl.textContent = "";
    legendHelpEl.innerHTML = "";
    legendRosterEl.innerHTML = "";
    return;
  }
  activeViewportBBox = computeEffectiveBBox(viewportMode, data, frameIndex, bbox);
  drawFrame(data.frames[frameIndex]);
  updateReadout();
  updateBombHud(data.frames[frameIndex]);
  updateLegendRoster(data.frames[frameIndex]);
  renderCoachAndComments();
}

function renderCoachAndComments(): void {
  const round = data?.frames.length ? data.frames[frameIndex][1] : 0;
  const drawings = coachStore.forRound(round);
  const preview = coachInput?.currentPreview ?? null;
  renderCoachOverlay(coachCtx, coachOverlay.width, coachOverlay.height, drawings, worldXYToCanvas, preview);
  renderCommentMarkers(round);
}

function buildLegend(): void {
  if (!data || !legendHelpEl) return;
  let mapImgHelp = "";
  if (usingOverview()) {
    mapImgHelp = `<strong>Map image:</strong> loaded (<code>public/map/</code> or <code>public/maps/</code>: <code>${escapeHtml(data.mapName)}.png</code>, <code>${escapeHtml(data.mapName)}_radar.png</code>, or <code>image.png</code>) — aligned via <code>src/mapOverview.ts</code>.<br/><br/>`;
  } else if (overviewCfg) {
    mapImgHelp = `<strong>Map image:</strong> no PNG yet. Put a square radar/overview in <code>public/map/</code> or <code>public/maps/</code> as <code>${escapeHtml(
      data.mapName,
    )}.png</code>, <code>${escapeHtml(data.mapName)}_radar.png</code>, or <code>image.png</code>.<br/><br/>`;
  } else {
    mapImgHelp = `<strong>Map image:</strong> this map isn’t listed in <code>src/mapOverview.ts</code>, so only the numeric auto-fit grid is used (add constants + PNG to enable a layout texture).<br/><br/>`;
  }

  legendHelpEl.innerHTML =
    `<div class="legend-note"><strong>Project layout:</strong> helper code lives under <code>src/utils/</code>; it isn’t rendered on the canvas.<br/><br/>${mapImgHelp}<strong>Roster panel:</strong> team cash totals + per-player money, active gun, and grenades when exported from a current <code>.dem</code>. A lone em dash (—) means missing data: old JSON without economy rows (re-export), demo/parser skipped that field on some ticks, no grenades in <code>inventory</code>, or no equipped weapon name on that sample.<br/><br/><strong>Bomb:</strong> green ring = carrier (<code>inventory</code> C4); amber diamond = dropped; red disk + fuse = planted (${BOMB_FUSE_SEC}s fuse cap; ends sooner if demo records explode/defuse). Re-export JSON for bomb fields.<br/><br/><strong>Round clock:</strong> Uses <code>roundClockStarts</code> + <code>roundEndsHud</code>: live countdown after <code>round_freeze_end</code>; buy-time freeze shows <strong>1:55 · freeze</strong> (not confused with post-win <strong>0:00 · between rounds</strong>). Older JSON without <code>roundEndsHud</code> falls back to frame-based timing (re-export).<br/><br/><strong>Gunshots:</strong> slim white beams from <code>weapon_fire</code> (ballistic only).<br/><br/><strong>Utilities:</strong> tinted throw beams.<br/><br/><strong>Effects:</strong> smoke = white disk with seconds left (viewer window ${SMOKE_LIFETIME_SEC}s); HE / flash / molotov from detonation events. Gold halo = flashed player when <code>player_blind</code> is exported.</div>`;
}

function pct(n: number): string {
  return `${n.toFixed(0)}%`;
}

function kdColor(kd: number): string {
  if (kd >= 1.5) return "good";
  if (kd >= 0.8) return "";
  return "bad";
}

function renderBar(value: number, max: number, cls = ""): string {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="analysis-bar-track"><div class="analysis-bar-fill ${cls ? `analysis-bar-fill--${cls}` : ""}" style="width:${w.toFixed(1)}%"></div></div>`;
}

function buildAnalysisPanel(): void {
  if (!data || !analysis) {
    analysisContentEl.innerHTML = '<p class="analysis-empty">Load a demo to see analysis.</p>';
    return;
  }

  const parts: string[] = [];

  // Player selector
  parts.push(`<select class="analysis-player-select" id="analysis-player-sel">`);
  parts.push(`<option value="-1">— All players (team view) —</option>`);
  for (const p of analysis.players) {
    const team = p.team === 2 ? "T" : p.team === 3 ? "CT" : `T${p.team}`;
    const sel = p.idx === analysisPlayerIdx ? " selected" : "";
    parts.push(`<option value="${p.idx}"${sel}>[${team}] ${escapeHtml(p.name)}</option>`);
  }
  parts.push(`</select>`);

  if (analysisPlayerIdx >= 0) {
    const ps = analysis.players.find((p) => p.idx === analysisPlayerIdx);
    if (ps) {
      // Combat stats
      parts.push(`<div class="analysis-section">`);
      parts.push(`<p class="analysis-section-title">Combat</p>`);
      const kdCls = kdColor(ps.kdRatio);
      parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">K / D / KD</span><span class="analysis-stat-value analysis-stat-value--${kdCls || ""}">
        ${ps.kills} / ${ps.deaths} / ${ps.kdRatio.toFixed(2)}</span></div>`);
      parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Headshot rate</span><span class="analysis-stat-value">${pct(ps.headshotPct)}</span></div>`);
      parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Rounds played</span><span class="analysis-stat-value">${ps.roundsPlayed}</span></div>`);

      if (ps.weaponKills.length > 0) {
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Top weapon</span><span class="analysis-stat-value">${escapeHtml(ps.favoriteWeapon ?? "—")}</span></div>`);
        const maxWK = ps.weaponKills[0].count;
        for (const wk of ps.weaponKills.slice(0, 4)) {
          parts.push(`<div class="analysis-bar-row">`);
          parts.push(`<div class="analysis-bar-label"><span>${escapeHtml(wk.weapon)}</span><span>${wk.count} kill${wk.count !== 1 ? "s" : ""}</span></div>`);
          parts.push(renderBar(wk.count, maxWK));
          parts.push(`</div>`);
        }
      }
      parts.push(`</div>`);

      // Positioning
      if (ps.topAreas.length > 0) {
        parts.push(`<div class="analysis-section">`);
        parts.push(`<p class="analysis-section-title">Positioning</p>`);
        for (const a of ps.topAreas.slice(0, 5)) {
          parts.push(`<div class="analysis-bar-row">`);
          parts.push(`<div class="analysis-bar-label"><span>${escapeHtml(a.area)}</span><span>${pct(a.pct * 100)}</span></div>`);
          parts.push(renderBar(a.pct, 1));
          parts.push(`</div>`);
        }
        if (ps.deathAreas.length > 0) {
          parts.push(`<div class="analysis-stat-row" style="margin-top:0.5rem"><span class="analysis-stat-label" style="font-weight:600">Most deaths at</span></div>`);
          for (const da of ps.deathAreas.slice(0, 3)) {
            parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label" style="padding-left:0.5rem">${escapeHtml(da.area)}</span><span class="analysis-stat-value analysis-stat-value--bad">${da.ticks}×</span></div>`);
          }
        }
        if (ps.killAreas.length > 0) {
          parts.push(`<div class="analysis-stat-row" style="margin-top:0.35rem"><span class="analysis-stat-label" style="font-weight:600">Most kills at</span></div>`);
          for (const ka of ps.killAreas.slice(0, 3)) {
            parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label" style="padding-left:0.5rem">${escapeHtml(ka.area)}</span><span class="analysis-stat-value analysis-stat-value--good">${ka.ticks}×</span></div>`);
          }
        }
        parts.push(`</div>`);
      }

      // Timing
      {
        parts.push(`<div class="analysis-section">`);
        parts.push(`<p class="analysis-section-title">Timing &amp; Habits</p>`);

        if (ps.firstShotSamples >= 3 && ps.firstShotAvgSec >= 0) {
          const vulnClass = ps.firstShotStdDev <= 10 ? "analysis-stat-value--warn" : "";
          parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">First peek/shot avg</span><span class="analysis-stat-value ${vulnClass}">${ps.firstShotAvgSec.toFixed(0)}s ±${ps.firstShotStdDev.toFixed(0)}s</span></div>`);
          if (ps.firstShotStdDev <= 10) {
            const lo = Math.max(0, ps.firstShotAvgSec - ps.firstShotStdDev);
            const hi = ps.firstShotAvgSec + ps.firstShotStdDev;
            parts.push(`<div class="timing-vuln-badge">⚠ Timing window: ${lo.toFixed(0)}s–${hi.toFixed(0)}s</div>`);
          }
        }

        if (ps.deathTimingSamples >= 3 && ps.deathTimingAvgSec >= 0) {
          const vulnClass = ps.deathTimingStdDev <= 12 ? "analysis-stat-value--bad" : "";
          parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Avg death timing</span><span class="analysis-stat-value ${vulnClass}">${ps.deathTimingAvgSec.toFixed(0)}s ±${ps.deathTimingStdDev.toFixed(0)}s</span></div>`);
          if (ps.deathTimingStdDev <= 12) {
            parts.push(`<div class="timing-vuln-badge timing-vuln-badge--danger">⚠ Exploitable: opponent can time ~${ps.deathTimingAvgSec.toFixed(0)}s</div>`);
          }
        }

        if (ps.kills > 0 && ps.avgKillTimeSec >= 0) {
          parts.push(`<div class="analysis-stat-row" style="margin-top:0.4rem"><span class="analysis-stat-label">Avg kill timing</span><span class="analysis-stat-value">${ps.avgKillTimeSec.toFixed(0)}s</span></div>`);
          parts.push(`<div class="analysis-bar-label" style="margin-top:0.3rem"><span style="color:#e05555">Early &lt;40s</span><span>Mid</span><span style="color:#5b8fd8">Late &gt;75s</span></div>`);
          parts.push(`<div class="timing-bar">`);
          parts.push(`<div class="timing-bar-early" style="flex:${Math.max(ps.earlyPct, 0.01)}" title="Early ${pct(ps.earlyPct)}"></div>`);
          parts.push(`<div class="timing-bar-mid" style="flex:${Math.max(ps.midPct, 0.01)}" title="Mid ${pct(ps.midPct)}"></div>`);
          parts.push(`<div class="timing-bar-late" style="flex:${Math.max(ps.latePct, 0.01)}" title="Late ${pct(ps.latePct)}"></div>`);
          parts.push(`</div>`);
          parts.push(`<div class="analysis-bar-label"><span>${pct(ps.earlyPct)}</span><span>${pct(ps.midPct)}</span><span>${pct(ps.latePct)}</span></div>`);
        }

        parts.push(`</div>`);
      }

      // Grenades
      const totalUtil = ps.smokes + ps.flashes + ps.hes + ps.molotovs;
      if (totalUtil > 0) {
        parts.push(`<div class="analysis-section">`);
        parts.push(`<p class="analysis-section-title">Utility Usage</p>`);
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Smokes</span><span class="analysis-stat-value">${ps.smokes}</span></div>`);
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Flashes</span><span class="analysis-stat-value">${ps.flashes}</span></div>`);
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">HE grenades</span><span class="analysis-stat-value">${ps.hes}</span></div>`);
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Molotovs</span><span class="analysis-stat-value">${ps.molotovs}</span></div>`);
        if (ps.roundsPlayed > 0) {
          parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Util/round avg</span><span class="analysis-stat-value">${(totalUtil / ps.roundsPlayed).toFixed(1)}</span></div>`);
        }
        parts.push(`</div>`);
      }
    }
  } else {
    // Team view
    for (const ts of analysis.teams) {
      const teamLabel = ts.team === 2 ? "T Side" : "CT Side";
      const teamCol = ts.team === 2 ? "t" : "ct";
      const total = ts.roundsWon + ts.roundsLost;
      parts.push(`<div class="analysis-section">`);
      parts.push(`<div class="analysis-team-header"><div class="analysis-team-badge" style="background:${ts.team === 2 ? "var(--t)" : "var(--ct)"}"></div><span class="analysis-section-title" style="margin:0">${teamLabel}</span></div>`);
      if (total > 0) {
        const wr = (ts.roundsWon / total) * 100;
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Win rate</span><span class="analysis-stat-value">${ts.roundsWon}/${total} (${pct(wr)})</span></div>`);
        parts.push(renderBar(ts.roundsWon, total, teamCol));
      }
      if (ts.team === 2) {
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Bombs planted</span><span class="analysis-stat-value">${ts.bombsPlanted}</span></div>`);
        if (ts.bombsPlanted > 0) {
          parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Exploded / defused</span><span class="analysis-stat-value">${ts.bombsExploded} / ${ts.bombsDefused}</span></div>`);
        }
      }
      if (ts.firstEngagementSamples >= 4 && ts.firstEngagementAvgSec >= 0) {
        const vulnClass = ts.firstEngagementStdDev <= 10 ? "analysis-stat-value--warn" : "";
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">First engagement avg</span><span class="analysis-stat-value ${vulnClass}">${ts.firstEngagementAvgSec.toFixed(0)}s ±${ts.firstEngagementStdDev.toFixed(0)}s</span></div>`);
        if (ts.firstEngagementStdDev <= 10) {
          const lo = Math.max(0, ts.firstEngagementAvgSec - ts.firstEngagementStdDev);
          const hi = ts.firstEngagementAvgSec + ts.firstEngagementStdDev;
          parts.push(`<div class="timing-vuln-badge">⚠ Predictable window: ${lo.toFixed(0)}s–${hi.toFixed(0)}s</div>`);
        }
      }
      if (ts.commonAreas.length > 0) {
        parts.push(`<div style="margin-top:0.45rem"><span class="analysis-stat-label" style="font-weight:600;color:var(--text)">Most active zones</span></div>`);
        for (const a of ts.commonAreas.slice(0, 5)) {
          parts.push(`<div class="analysis-bar-row">`);
          parts.push(`<div class="analysis-bar-label"><span>${escapeHtml(a.area)}</span><span>${pct(a.pct * 100)}</span></div>`);
          parts.push(renderBar(a.pct, 1, teamCol));
          parts.push(`</div>`);
        }
      }
      parts.push(`</div>`);
    }

    // Player K/D summary
    parts.push(`<div class="analysis-section">`);
    parts.push(`<p class="analysis-section-title">Player Summary</p>`);
    const sorted = [...analysis.players].sort((a, b) => b.kdRatio - a.kdRatio);
    for (const p of sorted) {
      const teamLabel = p.team === 2 ? "T" : p.team === 3 ? "CT" : "?";
      const col = p.team === 2 ? "var(--t)" : "var(--ct)";
      const kdCls = kdColor(p.kdRatio);
      parts.push(`<div class="analysis-stat-row">`);
      parts.push(`<span class="analysis-stat-label"><span style="color:${col};font-size:0.65rem;margin-right:0.3rem">[${teamLabel}]</span>${escapeHtml(p.name)}</span>`);
      parts.push(`<span class="analysis-stat-value${kdCls ? ` analysis-stat-value--${kdCls}` : ""}">${p.kills}/${p.deaths} (${p.kdRatio.toFixed(2)})</span>`);
      parts.push(`</div>`);
    }
    parts.push(`</div>`);
  }

  // Insights
  if (analysis.insights.length > 0) {
    parts.push(`<div class="analysis-section">`);
    parts.push(`<p class="analysis-section-title">AI Insights</p>`);
    parts.push(`<ul class="analysis-insights">`);
    for (const ins of analysis.insights) {
      parts.push(`<li class="analysis-insight">${escapeHtml(ins)}</li>`);
    }
    parts.push(`</ul>`);
    parts.push(`</div>`);
  }

  analysisContentEl.innerHTML = parts.join("");

  const sel = document.getElementById("analysis-player-sel") as HTMLSelectElement | null;
  if (sel) {
    sel.addEventListener("change", () => {
      analysisPlayerIdx = Number(sel.value);
      buildAnalysisPanel();
      render();
    });
  }
}

function buildDuelsPanel(): void {
  if (!data) {
    duelsContentEl.innerHTML = '<p class="analysis-empty">Load a demo to see duel stats.</p>';
    return;
  }
  if (!data.kills?.length) {
    duelsContentEl.innerHTML =
      '<p class="analysis-empty">No kill data in this demo — re-export to enable duel stats.</p>';
    return;
  }

  const parts: string[] = [];

  // Duel matrix
  const matrix = buildDuelMatrix(data);
  const players = data.players;
  const countOf = new Map<string, number>();
  for (const c of matrix) countOf.set(`${c.killerIdx}_${c.victimIdx}`, c.count);
  const maxCount = matrix.reduce((m, c) => Math.max(m, c.count), 0);

  parts.push(`<div class="analysis-section">`);
  parts.push(`<p class="analysis-section-title">Duel matrix (rows killed columns)</p>`);
  parts.push(`<div class="duel-matrix-wrap"><table class="duel-matrix">`);
  parts.push(`<thead><tr><th></th>`);
  for (const p of players) {
    parts.push(`<th style="color:${teamColor(p.team)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name.slice(0, 3))}</th>`);
  }
  parts.push(`</tr></thead><tbody>`);
  for (const rowP of players) {
    parts.push(`<tr><th style="color:${teamColor(rowP.team)}">${escapeHtml(rowP.name)}</th>`);
    for (const colP of players) {
      if (rowP.i === colP.i) {
        parts.push(`<td class="duel-matrix-cell duel-matrix-cell--self"></td>`);
        continue;
      }
      const count = countOf.get(`${rowP.i}_${colP.i}`) ?? 0;
      const alpha = maxCount > 0 ? 0.12 + 0.55 * (count / maxCount) : 0;
      const bg = count > 0 ? `rgba(224,85,85,${alpha.toFixed(2)})` : "transparent";
      parts.push(
        `<td class="duel-matrix-cell" style="background:${bg}" title="${escapeHtml(rowP.name)} killed ${escapeHtml(colP.name)} ${count} time${count === 1 ? "" : "s"}">${count || ""}</td>`,
      );
    }
    parts.push(`</tr>`);
  }
  parts.push(`</tbody></table></div>`);
  parts.push(`</div>`);

  // Opening duels
  parts.push(`<div class="analysis-section">`);
  parts.push(`<p class="analysis-section-title">Opening duels</p>`);
  parts.push(`<label class="toggle" style="margin-bottom:0.5rem">`);
  parts.push(
    `<input type="checkbox" id="duels-ignore-traded"${duelsIgnoreTraded ? " checked" : ""} /><span>Exclude traded (entry winner traded back within 5s)</span>`,
  );
  parts.push(`</label>`);

  const openingStats = buildOpeningDuelStats(data, { ignoreTraded: duelsIgnoreTraded });
  for (const os of openingStats.sort((a, b) => a.team - b.team)) {
    const teamLabel = os.team === 2 ? "T side" : os.team === 3 ? "CT side" : `Team ${os.team}`;
    parts.push(
      `<div class="analysis-team-header"><div class="analysis-team-badge" style="background:${teamColor(os.team)}"></div><span class="analysis-section-title" style="margin:0">${teamLabel}</span></div>`,
    );
    parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Opening duels won</span><span class="analysis-stat-value">${os.duelsWon}</span></div>`);
    parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Opening duels lost</span><span class="analysis-stat-value">${os.duelsLost}</span></div>`);
    parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Won → round won</span><span class="analysis-stat-value analysis-stat-value--good">${pct(os.conversionPct)}</span></div>`);
    parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">Lost → round lost</span><span class="analysis-stat-value analysis-stat-value--bad">${pct(os.lostConversionPct)}</span></div>`);
  }
  parts.push(`</div>`);

  duelsContentEl.innerHTML = parts.join("");

  const ignoreTradedEl = document.getElementById("duels-ignore-traded") as HTMLInputElement | null;
  ignoreTradedEl?.addEventListener("change", () => {
    duelsIgnoreTraded = ignoreTradedEl.checked;
    buildDuelsPanel();
  });
}
const BUY_TYPE_LABEL: Record<string, string> = {
  pistol: "Pistol",
  eco: "Eco",
  semi: "Semi-buy",
  force: "Force-buy",
  full: "Full buy",
};
const BUY_TYPE_CLASS: Record<string, string> = {
  pistol: "",
  eco: "",
  semi: "",
  force: "warn",
  full: "good",
};

function buildEconomyPanel(): void {
  if (!data) {
    economyContentEl.innerHTML = '<p class="analysis-empty">Load a demo to see economy stats.</p>';
    return;
  }
  if (!data.roundClockStarts?.length) {
    economyContentEl.innerHTML =
      '<p class="analysis-empty">No round-clock data in this demo — re-export to enable economy stats.</p>';
    return;
  }

  const report = buildEconomyReport(data);
  const summary = summarizeByBuyType(report);
  const parts: string[] = [];

  parts.push(`<div class="analysis-section">`);
  parts.push(`<p class="analysis-section-title">Round outcomes by buy type</p>`);
  const maxRounds = summary.reduce((m, s) => Math.max(m, s.roundsWon + s.roundsLost), 0);
  for (const s of summary) {
    const total = s.roundsWon + s.roundsLost;
    parts.push(`<div class="analysis-bar-row">`);
    parts.push(
      `<div class="analysis-bar-label"><span>${BUY_TYPE_LABEL[s.buyType]}</span><span>${s.roundsWon}W / ${s.roundsLost}L</span></div>`,
    );
    parts.push(renderBar(total, maxRounds, BUY_TYPE_CLASS[s.buyType]));
    parts.push(`</div>`);
  }
  parts.push(`</div>`);

  for (const team of [2, 3]) {
    const teamRows = report.filter((r) => r.team === team);
    if (!teamRows.length) continue;
    const teamLabel = team === 2 ? "T side" : "CT side";
    parts.push(`<div class="analysis-section">`);
    parts.push(
      `<div class="analysis-team-header"><div class="analysis-team-badge" style="background:${teamColor(team)}"></div><span class="analysis-section-title" style="margin:0">${teamLabel} — by round</span></div>`,
    );
    for (const r of teamRows) {
      const badgeCls = BUY_TYPE_CLASS[r.buyType];
      const badgeClsAttr = badgeCls ? ` analysis-stat-value--${badgeCls}` : "";
      const wl = r.won === undefined ? "" : r.won ? " · won" : " · lost";
      parts.push(
        `<div class="analysis-stat-row"><span class="analysis-stat-label">Round ${r.round + 1} <span class="analysis-stat-value${badgeClsAttr}" style="font-size:0.7rem">${BUY_TYPE_LABEL[r.buyType]}</span>${wl}</span><span class="analysis-stat-value">$${r.startCash.toLocaleString()} cash · ~$${r.equipValue.toLocaleString()} equip</span></div>`,
      );
    }
    parts.push(`</div>`);
  }

  economyContentEl.innerHTML = parts.join("");
}
const UTILITY_WEAPON_SLUGS: { slug: string; label: string }[] = [
  { slug: "hegrenade", label: "HE" },
  { slug: "flashbang", label: "Flash" },
  { slug: "smokegrenade", label: "Smoke" },
  { slug: "molotov", label: "Molotov" },
  { slug: "incgrenade", label: "Incendiary" },
  { slug: "decoy", label: "Decoy" },
];

function nameForIdx(idx: number): string {
  return data?.players.find((p) => p.i === idx)?.name ?? `#${idx}`;
}

function buildUtilitiesPanel(): void {
  if (!data) {
    utilitiesContentEl.innerHTML = '<p class="analysis-empty">Load a demo to see utility stats.</p>';
    return;
  }

  const parts: string[] = [];
  parts.push(`<div class="subtab-row">`);
  for (const [id, label] of [
    ["throws", "Throws"],
    ["flashes", "Flashes"],
    ["damage", "Damage"],
  ] as const) {
    parts.push(
      `<button type="button" class="subtab${utilitiesSubTab === id ? " subtab--active" : ""}" data-subtab="${id}">${label}</button>`,
    );
  }
  parts.push(`</div>`);

  if (utilitiesSubTab === "throws") {
    if (!data.utilities?.length) {
      parts.push(`<p class="analysis-empty">No utility-throw data in this demo.</p>`);
    } else {
      for (const { slug, label } of UTILITY_WEAPON_SLUGS) {
        const stats = buildThrowStats(data, slug).sort((a, b) => b.thrown - a.thrown);
        if (!stats.length) continue;
        parts.push(`<div class="analysis-section">`);
        parts.push(`<p class="analysis-section-title">${label} thrown</p>`);
        const max = stats[0].thrown;
        for (const s of stats) {
          parts.push(`<div class="analysis-bar-row">`);
          parts.push(
            `<div class="analysis-bar-label"><span>${escapeHtml(nameForIdx(s.playerIdx))}</span><span>${s.thrown}</span></div>`,
          );
          parts.push(renderBar(s.thrown, max));
          parts.push(`</div>`);
        }
        parts.push(`</div>`);
      }
    }
  } else if (utilitiesSubTab === "flashes") {
    if (!data.flashVictims?.length) {
      parts.push(
        `<p class="analysis-empty">This demo records no blind events. GOTV/HLTV demos (such as Majors) usually omit this information, so flash stats cannot be computed. This is not an error.</p>`,
      );
    } else {
      const flashStats = buildFlashStats(data).sort((a, b) => b.enemiesBlinded - a.enemiesBlinded);
      parts.push(`<div class="analysis-section">`);
      parts.push(`<p class="analysis-section-title">Flash stats</p>`);
      for (const s of flashStats) {
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">${escapeHtml(nameForIdx(s.playerIdx))}</span><span class="analysis-stat-value">${s.thrown} thrown · ${s.enemiesBlinded} blinded</span></div>`);
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label" style="padding-left:0.5rem">avg duration</span><span class="analysis-stat-value">${s.avgDurationSec.toFixed(1)}s · ${s.blindedPerRound.toFixed(2)}/round</span></div>`);
      }
      parts.push(`</div>`);

      const impact = buildFlashImpact(data).sort((a, b) => b.killsFromBlinds - a.killsFromBlinds);
      if (impact.length) {
        parts.push(`<div class="analysis-section">`);
        parts.push(`<p class="analysis-section-title">Flash impact — enemies blinded who died while blind</p>`);
        for (const i of impact) {
          parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">${escapeHtml(nameForIdx(i.flasherIdx))}</span><span class="analysis-stat-value analysis-stat-value--good">${i.killsFromBlinds}</span></div>`);
        }
        parts.push(`</div>`);
      }
    }
  } else {
    const dmgStats = buildDamageStats(data);
    if (dmgStats === null) {
      parts.push(
        `<p class="analysis-empty">Purchase/damage data isn't available for this replay. Re-export the demo to see it.</p>`,
      );
    } else if (!dmgStats.length) {
      parts.push(`<p class="analysis-empty">No HE/molotov damage recorded.</p>`);
    } else {
      parts.push(`<div class="analysis-section">`);
      parts.push(`<p class="analysis-section-title">HE / molotov damage</p>`);
      for (const s of dmgStats.sort((a, b) => b.heDamage + b.molotovDamage - (a.heDamage + a.molotovDamage))) {
        parts.push(`<div class="analysis-stat-row"><span class="analysis-stat-label">${escapeHtml(nameForIdx(s.playerIdx))}</span><span class="analysis-stat-value">${s.heDamage} HE · ${s.molotovDamage} fire · ${s.utilityKills} kills</span></div>`);
      }
      parts.push(`</div>`);
    }
  }

  utilitiesContentEl.innerHTML = parts.join("");

  utilitiesContentEl.querySelectorAll<HTMLButtonElement>(".subtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      utilitiesSubTab = btn.dataset.subtab as typeof utilitiesSubTab;
      buildUtilitiesPanel();
    });
  });
}
function buildCommentsPanel(): void {
  const parts: string[] = [];

  if (!data) {
    commentsContentEl.innerHTML = '<p class="analysis-empty">Load a demo to add comments.</p>';
    return;
  }

  if (!commentModeEl.checked && !pendingComment) {
    parts.push(
      `<p class="analysis-empty">Check "Comment mode" above the map, then click a spot on the map to leave a comment.</p>`,
    );
  }

  if (pendingComment) {
    const p = pendingComment;
    parts.push(`<div class="analysis-section">`);
    parts.push(`<p class="analysis-section-title">New comment — round ${p.round + 1}</p>`);
    parts.push(`<textarea id="comment-draft-text" class="comment-draft-text" placeholder="Write a comment..." rows="3"></textarea>`);
    parts.push(`<div class="comment-draft-row">`);
    parts.push(`<select id="comment-draft-kind">`);
    for (const kind of Object.keys(COMMENT_KIND_LABEL) as CommentKind[]) {
      parts.push(`<option value="${kind}">${COMMENT_KIND_LABEL[kind]}</option>`);
    }
    parts.push(`</select>`);
    parts.push(`<input type="text" id="comment-draft-author" placeholder="Your name (optional)" />`);
    parts.push(`</div>`);
    parts.push(`<div class="comment-draft-row">`);
    parts.push(`<button type="button" id="comment-draft-save">Save</button>`);
    parts.push(`<button type="button" id="comment-draft-cancel">Cancel</button>`);
    parts.push(`</div>`);
    parts.push(`</div>`);
  }

  const all = commentStore.listAll();
  parts.push(`<div class="analysis-section">`);
  parts.push(`<p class="analysis-section-title">Comments (${all.length})</p>`);
  if (!all.length) {
    parts.push(`<p class="analysis-empty">No comments yet.</p>`);
  }
  for (const c of all) {
    parts.push(`<div class="comment-row">`);
    parts.push(
      `<span class="comment-kind-badge" style="background:${COMMENT_KIND_COLOR[c.kind]}20;color:${COMMENT_KIND_COLOR[c.kind]};border:1px solid ${COMMENT_KIND_COLOR[c.kind]}55">${COMMENT_KIND_LABEL[c.kind]}</span>`,
    );
    parts.push(`<span class="comment-text">${escapeHtml(c.text)}</span>`);
    if (c.author) parts.push(`<span class="comment-author">— ${escapeHtml(c.author)}</span>`);
    parts.push(`<div class="comment-row-actions">`);
    parts.push(`<button type="button" class="comment-jump" data-tick="${c.tick}">Jump to moment</button>`);
    parts.push(`<button type="button" class="comment-delete" data-id="${c.id}">Delete</button>`);
    parts.push(`</div>`);
    parts.push(`</div>`);
  }
  parts.push(`</div>`);

  commentsContentEl.innerHTML = parts.join("");

  document.getElementById("comment-draft-save")?.addEventListener("click", () => {
    if (!pendingComment) return;
    const text = (document.getElementById("comment-draft-text") as HTMLTextAreaElement)?.value.trim();
    if (!text) return;
    const kind = (document.getElementById("comment-draft-kind") as HTMLSelectElement).value as CommentKind;
    const author = (document.getElementById("comment-draft-author") as HTMLInputElement).value.trim();
    commentStore.add({
      tick: pendingComment.tick,
      round: pendingComment.round,
      targetType: "point",
      x: pendingComment.x,
      y: pendingComment.y,
      text,
      kind,
      author: author || undefined,
    });
    pendingComment = null;
    buildCommentsPanel();
    renderCoachAndComments();
  });

  document.getElementById("comment-draft-cancel")?.addEventListener("click", () => {
    pendingComment = null;
    buildCommentsPanel();
  });

  commentsContentEl.querySelectorAll<HTMLButtonElement>(".comment-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      jumpToTick(Number(btn.dataset.tick));
    });
  });

  commentsContentEl.querySelectorAll<HTMLButtonElement>(".comment-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      commentStore.remove(btn.dataset.id!);
      buildCommentsPanel();
      renderCoachAndComments();
    });
  });
}

function renderCommentMarkers(round: number): void {
  for (const c of commentStore.listForRound(round)) {
    if (c.x === undefined || c.y === undefined) continue;
    const { x, y } = worldXYToCanvas(c.x, c.y);
    coachCtx.save();
    coachCtx.fillStyle = COMMENT_KIND_COLOR[c.kind];
    coachCtx.strokeStyle = "rgba(10,12,15,0.85)";
    coachCtx.lineWidth = 1.5;
    coachCtx.beginPath();
    coachCtx.arc(x, y, 7, 0, Math.PI * 2);
    coachCtx.fill();
    coachCtx.stroke();
    coachCtx.fillStyle = "rgba(10,12,15,0.95)";
    coachCtx.font = "700 9px Segoe UI, system-ui, sans-serif";
    coachCtx.textAlign = "center";
    coachCtx.textBaseline = "middle";
    coachCtx.fillText("!", x, y + 1);
    coachCtx.restore();
  }
}

/** Shared "All / [T] name / [CT] name" roster dropdown, reused by heatmap + follow-mode selects. */
function populatePlayerSelect(el: HTMLSelectElement, allLabel = "All"): void {
  if (!data) {
    el.innerHTML = `<option value="-1">${escapeHtml(allLabel)}</option>`;
    return;
  }
  const parts: string[] = [`<option value="-1">${escapeHtml(allLabel)}</option>`];
  for (const p of data.players) {
    const team = p.team === 2 ? "[T]" : p.team === 3 ? "[CT]" : "";
    parts.push(`<option value="${p.i}">${team} ${escapeHtml(p.name)}</option>`);
  }
  el.innerHTML = parts.join("");
}

function updateHeatmapPlayerSelect(): void {
  populatePlayerSelect(heatmapPlayerSelectEl, "All");
  populatePlayerSelect(followPlayerSelectEl, "Select a player…");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wall-clock seconds to advance from frames[fromIdx] → frames[fromIdx + 1] (real Δtick / tickRate). */
function secondsForFrameStep(fromIdx: number): number {
  if (!data) return 0;
  if (fromIdx >= data.frames.length - 1) {
    return Math.max(1e-6, data.tickStep / data.tickRate);
  }
  const t0 = data.frames[fromIdx][0];
  const t1 = data.frames[fromIdx + 1][0];
  const dTick = Math.max(1, t1 - t0);
  return dTick / data.tickRate;
}

const AUTO_ADVANCE_PAUSE_MS = 1500;

function tickPlayback(ts: number): void {
  if (!playing || !data) return;
  if (lastFrameTime === 0) lastFrameTime = ts;
  const dt = (ts - lastFrameTime) / 1000;
  lastFrameTime = ts;
  playAccum += dt;
  const prevTick = data.frames[frameIndex][0];
  while (frameIndex < data.frames.length - 1) {
    const stepSec = secondsForFrameStep(frameIndex) / Math.max(0.1, playSpeed);
    if (playAccum < stepSec) break;
    playAccum -= stepSec;
    frameIndex += 1;
  }
  scrub.value = String(frameIndex);
  render();

  if (autoAdvance && data.roundEndsHud?.length) {
    const round = currentRound();
    const curTick = data.frames[frameIndex][0];
    const justEnded =
      round !== lastAutoAdvanceRound &&
      data.roundEndsHud.some(([t, r]) => r === round && t > prevTick && t <= curTick);
    if (justEnded) {
      lastAutoAdvanceRound = round;
      stopPlayback();
      setTimeout(() => {
        jumpToRound(round + 1, { afterFreeze: skipFreezeOnRoundNav });
        if (!data?.frames.length || frameIndex >= data.frames.length - 1) return;
        playing = true;
        playBtn.setAttribute("aria-pressed", "true");
        playBtn.textContent = "Pause";
        raf = requestAnimationFrame(tickPlayback);
      }, AUTO_ADVANCE_PAUSE_MS);
      return;
    }
  }

  if (frameIndex >= data.frames.length - 1) {
    playing = false;
    playBtn.setAttribute("aria-pressed", "false");
    playBtn.textContent = "Play";
    lastFrameTime = 0;
    playAccum = 0;
    return;
  }
  raf = requestAnimationFrame(tickPlayback);
}

playBtn.addEventListener("click", () => {
  if (!data?.frames.length) return;
  playing = !playing;
  playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
  playBtn.textContent = playing ? "Pause" : "Play";
  cancelAnimationFrame(raf);
  lastFrameTime = 0;
  playAccum = 0;
  if (playing) {
    if (frameIndex >= data.frames.length - 1) frameIndex = 0;
    raf = requestAnimationFrame(tickPlayback);
  }
});

scrub.addEventListener("input", () => {
  if (!data) return;
  frameIndex = Number(scrub.value);
  render();
});

/** Jump playback to the first frame at or after `tick`, pausing playback. */
function jumpToTick(tick: number): void {
  if (!data?.frames.length) return;
  stopPlayback();
  const idx = Math.min(
    Math.max(lowerBoundBy(data.frames, tick, (f) => f[0]), 0),
    data.frames.length - 1,
  );
  frameIndex = idx;
  scrub.value = String(frameIndex);
  render();
}

/**
 * Jump to a round boundary. `afterFreeze` targets the live-clock start
 * (skips buy/freeze time); otherwise targets the round's first exported frame.
 */
function jumpToRound(round: number, opts: { afterFreeze?: boolean } = {}): void {
  if (!data?.frames.length) return;
  const target = Math.max(0, round);
  if (opts.afterFreeze) {
    const match = (data.roundClockStarts ?? []).find(([, r]) => r === target);
    if (match) {
      jumpToTick(match[0]);
      return;
    }
  }
  const frame = data.frames.find((f) => f[1] === target);
  if (frame) jumpToTick(frame[0]);
}

function currentRound(): number {
  return data?.frames.length ? data.frames[frameIndex][1] : 0;
}

prevRoundBtn.addEventListener("click", () => {
  jumpToRound(currentRound() - 1, { afterFreeze: skipFreezeOnRoundNav });
});

nextRoundBtn.addEventListener("click", () => {
  jumpToRound(currentRound() + 1, { afterFreeze: skipFreezeOnRoundNav });
});

function setExportProgressVisible(show: boolean): void {
  exportProgressEl.hidden = !show;
  if (!show) {
    exportProgressFill.style.width = "0%";
    exportProgressFill.classList.remove("export-progress-fill--pulse");
    exportProgressLabel.textContent = "";
  }
}

function updateExportProgress(
  pct: number,
  label: string,
  phase: string,
): void {
  const p = Math.min(100, Math.max(0, pct));
  exportProgressFill.style.width = `${p}%`;
  exportProgressLabel.textContent = `${Math.round(p)}% — ${label}`;
  exportProgressFill.classList.toggle(
    "export-progress-fill--pulse",
    phase === "ticks" || phase === "scan_rows",
  );
}

async function fetchExportDemoNdjson(fd: FormData): Promise<DemoData> {
  const res = await fetch("/api/export-dem", { method: "POST", body: fd });
  const ct = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const msg =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (!res.body || !ct.includes("ndjson")) {
    throw new Error("Unexpected export response (need npm run dev).");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let payload: DemoData | undefined;

  const handleLine = (raw: string): void => {
    const line = raw.trim();
    if (!line) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid export stream.");
    }
    const ty = msg.type;
    if (ty === "progress") {
      const pct = Number(msg.pct);
      const label = typeof msg.label === "string" ? msg.label : "";
      const phase = typeof msg.phase === "string" ? msg.phase : "";
      if (Number.isFinite(pct)) {
        updateExportProgress(pct, label, phase);
      }
      return;
    }
    if (ty === "done") {
      payload = msg.payload as DemoData;
      return;
    }
    if (ty === "error") {
      throw new Error(
        typeof msg.error === "string" ? msg.error : "Export failed.",
      );
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line);
    }
    if (done) {
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          handleLine(line);
        }
      }
      break;
    }
  }

  if (!payload || !validateDemoData(payload)) {
    throw new Error("Server returned invalid demo JSON.");
  }
  return payload;
}

function estimateWasmTicksMs(byteLength: number): number {
  return Math.min(
    180_000,
    Math.max(15_000, 12_000 + (byteLength * 110) / (1024 * 1024)),
  );
}

/**
 * Parse `.dem` in-browser via demoparser2 WASM (worker). Uses transferable buffer copy.
 * Synthetic progress on main thread while WASM blocks inside parseTicks (same idea as dev-server NDJSON merge).
 */
function exportViaWasmWorker(
  buffer: ArrayBuffer,
  demoPathLabel: string,
  tickStep: number,
): Promise<DemoData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./workers/demo-wasm.worker.ts", import.meta.url),
      { type: "module" },
    );

    let workerPct = 6;
    let syntheticPct = 6;
    let lastLabel = "Initializing WASM parser…";
    let lastPhase = "ticks";
    const started = Date.now();
    const estimateTicksMs = estimateWasmTicksMs(buffer.byteLength);

    const iv = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const t = Math.min(1.25, elapsed / estimateTicksMs);
      syntheticPct = Math.min(36, 8 + t * 28);
      const pct = Math.min(94, Math.max(workerPct, syntheticPct));
      const label =
        workerPct >= syntheticPct
          ? lastLabel
          : `Parsing demo (WASM)… ~${Math.round(syntheticPct)}% est.`;
      updateExportProgress(pct, label, lastPhase);
    }, 280);

    const cleanup = (): void => {
      window.clearInterval(iv);
      worker.terminate();
    };

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as {
        type?: string;
        pct?: number;
        phase?: string;
        label?: string;
        payload?: DemoData;
        error?: string;
      };
      if (msg.type === "progress") {
        const p = Number(msg.pct);
        if (Number.isFinite(p)) workerPct = Math.max(workerPct, p);
        if (typeof msg.label === "string") lastLabel = msg.label;
        if (typeof msg.phase === "string") lastPhase = msg.phase;
        const pct = Math.min(94, Math.max(workerPct, syntheticPct));
        updateExportProgress(
          pct,
          workerPct >= syntheticPct ? lastLabel : `Parsing demo (WASM)… ~${Math.round(syntheticPct)}% est.`,
          lastPhase,
        );
        return;
      }
      if (msg.type === "done") {
        cleanup();
        if (!msg.payload || !validateDemoData(msg.payload)) {
          reject(new Error("WASM export returned invalid demo JSON."));
          return;
        }
        updateExportProgress(99, "Finishing…", "finalize");
        resolve(msg.payload);
        return;
      }
      if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.error ?? "WASM export failed."));
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || "WASM worker failed to load or execute."));
    };

    worker.postMessage(
      {
        type: "export",
        buffer,
        demoPathLabel,
        tickStep,
      },
      [buffer],
    );
  });
}

async function exportDemoPreferred(file: File): Promise<DemoData> {
  const fullAb = await file.arrayBuffer();
  const tickStep = 1;
  const label = file.name;

  let wasmErr: Error | undefined;
  try {
    const wasmBuffer = fullAb.slice(0);
    return await exportViaWasmWorker(wasmBuffer, label, tickStep);
  } catch (e) {
    wasmErr = e instanceof Error ? e : new Error(String(e));
  }

  const fd = new FormData();
  fd.append("demo", new Blob([fullAb]), label);
  try {
    return await fetchExportDemoNdjson(fd);
  } catch (serverErr) {
    const serverMsg =
      serverErr instanceof Error ? serverErr.message : String(serverErr);
    throw new Error(
      `${wasmErr?.message ?? "WASM export failed."} Server fallback: ${serverMsg}`,
    );
  }
}

demoLoadUrlBtn.addEventListener("click", () => {
  loadDemoFromUrl(demoUrlSelect.value);
});

demoExportDemBtn.addEventListener("click", async () => {
  const file = demoDemInput.files?.[0];
  if (!file) {
    errorEl.hidden = false;
    errorEl.textContent = "Choose a .dem file first.";
    return;
  }

  demoExportDemBtn.disabled = true;
  errorEl.hidden = true;
  setExportProgressVisible(true);
  updateExportProgress(2, "Starting export (browser WASM)…", "start");
  metaEl.textContent = "Exporting demo (browser WASM, server fallback if needed)…";
  try {
    const body = await exportDemoPreferred(file);
    await applyDemoPayload(body, { kind: "file", label: file.name });
    metaEl.textContent = `Loaded: ${body.demoPath} (${body.mapName})`;
  } catch (e) {
    errorEl.hidden = false;
    const base = e instanceof Error ? e.message : "Export failed.";
    const hint =
      base.includes("fetch") || base.includes("Failed to fetch")
        ? " For static hosting, WASM export must succeed — check browser console. With npm run dev, native server export is used as fallback."
        : base.includes("Missing multipart") || base.includes("404")
          ? " Server fallback needs npm run dev — WASM-only mode works from vite preview/build if parsing succeeds."
          : "";
    errorEl.textContent = `${base}${hint}`;
    metaEl.textContent =
      "Choose a .dem (browser WASM + optional dev-server fallback), bundled JSON, or export file.";
    render();
  } finally {
    setExportProgressVisible(false);
    demoExportDemBtn.disabled = false;
  }
});

demoFileInput.addEventListener("change", () => {
  const file = demoFileInput.files?.[0];
  if (!file) return;
  loadDemoFromFile(file);
  demoFileInput.value = "";
});

showShotsEl.addEventListener("change", () => {
  render();
});

showUtilitiesEl.addEventListener("change", () => {
  render();
});

showEffectsEl.addEventListener("change", () => {
  render();
});

showPositionsEl.addEventListener("change", () => {
  render();
});

showHeatmapEl.addEventListener("change", () => {
  render();
});

skipFreezeEl.addEventListener("change", () => {
  skipFreezeOnRoundNav = skipFreezeEl.checked;
});

autoAdvanceEl.addEventListener("change", () => {
  autoAdvance = autoAdvanceEl.checked;
  lastAutoAdvanceRound = -1;
});

perfModeEl.addEventListener("change", () => {
  perfMode = perfModeEl.checked;
  render();
});

function updateViewportMode(): void {
  if (followModeEl.checked) {
    const idx = Number(followPlayerSelectEl.value);
    viewportMode = Number.isFinite(idx) && idx >= 0 ? { kind: "follow", playerIdx: idx } : { kind: "fixed" };
  } else if (autoZoomEl.checked) {
    viewportMode = { kind: "auto-zoom" };
  } else {
    viewportMode = { kind: "fixed" };
  }
  render();
}

autoZoomEl.addEventListener("change", () => {
  if (autoZoomEl.checked) {
    followModeEl.checked = false;
    followPlayerWrapEl.hidden = true;
  }
  updateViewportMode();
});

followModeEl.addEventListener("change", () => {
  followPlayerWrapEl.hidden = !followModeEl.checked;
  if (followModeEl.checked) autoZoomEl.checked = false;
  updateViewportMode();
});

followPlayerSelectEl.addEventListener("change", () => {
  updateViewportMode();
});

heatmapPlayerSelectEl.addEventListener("change", () => {
  analysisPlayerIdx = Number(heatmapPlayerSelectEl.value);
  render();
});

heatmapWeightSelectEl.addEventListener("change", () => {
  render();
});

heatmapFloorSelectEl.addEventListener("change", () => {
  render();
});

speedBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    playSpeed = Number(btn.dataset.speed ?? "1");
    speedBtns.forEach((b) => b.classList.toggle("speed-btn--active", b === btn));
  });
});

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => {
      b.classList.toggle("legend-tab--active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    const tab = btn.dataset.tab ?? "live";
    for (const [id, panel] of Object.entries(tabPanels)) {
      panel.classList.toggle("legend-panel--hidden", id !== tab);
    }
    tabOnActivate[tab]?.();
  });
});

const coachInput = new CoachInput(
  coachOverlay,
  coachStore,
  currentRound,
  canvasToWorldXY,
  () => renderCoachAndComments(),
);

function updateOverlayInteractivity(): void {
  const interactive = coachModeEl.checked || commentModeEl.checked;
  coachOverlay.classList.toggle("coach-overlay--interactive", interactive);
  coachToolsEl.hidden = !coachModeEl.checked;
  coachInput.tool = coachModeEl.checked ? (coachActiveTool() as CoachTool) : "select";
}

function coachActiveTool(): CoachTool {
  const active = document.querySelector<HTMLButtonElement>(".tool-btn--active");
  return (active?.dataset.tool as CoachTool) ?? "select";
}

coachModeEl.addEventListener("change", () => {
  if (coachModeEl.checked) commentModeEl.checked = false;
  updateOverlayInteractivity();
});

commentModeEl.addEventListener("change", () => {
  if (commentModeEl.checked) coachModeEl.checked = false;
  updateOverlayInteractivity();
});

toolBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    toolBtns.forEach((b) => b.classList.toggle("tool-btn--active", b === btn));
    coachInput.tool = (btn.dataset.tool as CoachTool) ?? "select";
  });
});

coachColorEl.addEventListener("input", () => {
  coachInput.color = coachColorEl.value;
});

coachThicknessEl.addEventListener("input", () => {
  coachInput.strokeWidth = Number(coachThicknessEl.value);
});

coachUndoBtn.addEventListener("click", () => {
  coachStore.undo();
  renderCoachAndComments();
});

coachRedoBtn.addEventListener("click", () => {
  coachStore.redo();
  renderCoachAndComments();
});

coachClearBtn.addEventListener("click", () => {
  coachStore.clearRound(currentRound());
  renderCoachAndComments();
});

coachOverlay.addEventListener("click", (ev) => {
  if (!commentModeEl.checked || !data?.frames.length) return;
  const rect = coachOverlay.getBoundingClientRect();
  const scaleX = coachOverlay.width / rect.width;
  const scaleY = coachOverlay.height / rect.height;
  const cx = (ev.clientX - rect.left) * scaleX;
  const cy = (ev.clientY - rect.top) * scaleY;
  const wp = canvasToWorldXY(cx, cy);
  const frame = data.frames[frameIndex];
  pendingComment = { tick: frame[0], round: frame[1], x: wp.x, y: wp.y };
  const tabBtn = document.getElementById("tab-comments") as HTMLButtonElement | null;
  tabBtn?.click();
});

async function tryLoadOverviewImage(mapName: string): Promise<HTMLImageElement | null> {
  const dirs = ["/map/", "/maps/"];
  const names = [`${mapName}.png`, `${mapName}_radar.png`, "image.png"];
  const candidates = dirs.flatMap((d) => names.map((n) => d + n));
  for (const src of candidates) {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = src;
    });
    if (img && img.naturalWidth > 0) return img;
  }
  return null;
}

function validateDemoData(x: unknown): x is DemoData {
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

async function applyDemoPayload(
  parsed: DemoData,
  source?: { kind: "url" | "file" | "session"; url?: string; label?: string },
): Promise<void> {
  stopPlayback();
  errorEl.hidden = true;
  data = parsed;

  const baseOverview = getMapOverview(data.mapName);
  overviewImage = baseOverview ? await tryLoadOverviewImage(data.mapName) : null;
  if (baseOverview && overviewImage) {
    const w = overviewImage.naturalWidth;
    const h = overviewImage.naturalHeight;
    overviewCfg =
      w > 0 && h > 0 && w === h
        ? { ...baseOverview, overviewPx: w }
        : { ...baseOverview };
  } else {
    overviewCfg = baseOverview;
  }

  const bb = computeSceneBounds(
    data.frames,
    data.shots,
    data.utilities,
    data.smokePops,
    data.hePops,
    data.flashPops,
    data.molotovPools,
    data.bombPlants as unknown as ShotTuple[] | undefined,
    data.bombDrops as unknown as ShotTuple[] | undefined,
  );
  bbox = bb ?? defaultBBox;

  scrub.max = String(Math.max(0, data.frames.length - 1));
  scrub.value = "0";
  frameIndex = 0;
  analysisPlayerIdx = -1;

  analysis = analyzeDemo(data, bb ?? defaultBBox);
  updateHeatmapPlayerSelect();
  heatmapFloorWrapEl.hidden = analysis.heatmapsByFloor.size === 0;
  heatmapFloorSelectEl.value = "all";

  setMetaLine();
  buildLegend();
  buildAnalysisPanel();
  render();

  if (source) {
    saveRecentDemo({
      label: source.label ?? data.mapName,
      mapName: data.mapName,
      roundCount: analysis.totalRounds,
      sourceKind: source.kind,
      url: source.url,
    });
    populateRecentDemosList();
  }
}

function populateRecentDemosList(): void {
  const entries = loadRecentDemos();
  recentDemosWrapEl.hidden = entries.length === 0;
  const parts: string[] = [];
  for (const e of entries) {
    if (e.sourceKind === "url") {
      parts.push(
        `<button type="button" class="recent-demo-chip" data-id="${escapeAttr(e.id)}" data-url="${escapeAttr(e.url ?? "")}">${escapeHtml(e.mapName)} · ${e.roundCount}rd</button>`,
      );
    } else {
      parts.push(
        `<span class="recent-demo-chip recent-demo-chip--disabled" title="Loaded from a local file — reopen manually">${escapeHtml(e.mapName)} · ${e.roundCount}rd (reopen manually)</span>`,
      );
    }
  }
  recentDemosListEl.innerHTML = parts.join("");
  recentDemosListEl.querySelectorAll<HTMLButtonElement>(".recent-demo-chip[data-url]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.url;
      if (url) void loadDemoFromUrl(url);
    });
  });
}

async function loadDemoFromUrl(url: string): Promise<void> {
  errorEl.hidden = true;
  const trimmed = url.trim();
  if (!trimmed) {
    errorEl.hidden = false;
    errorEl.textContent = "Pick a demo from the list.";
    return;
  }
  try {
    const res = await fetch(trimmed);
    if (!res.ok) throw new Error(`Could not fetch ${trimmed} (${res.status})`);
    const raw: unknown = await res.json();
    if (!validateDemoData(raw)) {
      throw new Error(
        "JSON is not a valid demo export (need mapName, tickRate, tickStep, players, frames).",
      );
    }
    await applyDemoPayload(raw, { kind: "url", url: trimmed });
  } catch (e) {
    errorEl.hidden = false;
    errorEl.textContent =
      e instanceof Error
        ? `${e.message} — run npm run export-demo or fix demos-index.json`
        : "Failed to load demo.";
  }
}

async function loadDemoFromFile(file: File): Promise<void> {
  errorEl.hidden = true;
  try {
    const text = await file.text();
    const raw: unknown = JSON.parse(text);
    if (!validateDemoData(raw)) {
      throw new Error(
        "File is not a valid demo export (need mapName, tickRate, tickStep, players, frames).",
      );
    }
    await applyDemoPayload(raw, { kind: "file", label: file.name });
  } catch (e) {
    errorEl.hidden = false;
    errorEl.textContent =
      e instanceof Error ? e.message : "Failed to read demo JSON.";
  }
}

sessionExportBtn.addEventListener("click", () => {
  if (!data) return;
  const envelope: SessionEnvelope = {
    kind: "cs2-2d-demo-viewer-session",
    version: 1,
    createdAt: new Date().toISOString(),
    demoData: data,
    comments: commentStore.toJSON(),
    coachDrawings: coachStore.toJSON(),
    playbackSettings: {
      playSpeed,
      showShots: showShotsEl.checked,
      showUtilities: showUtilitiesEl.checked,
      showEffects: showEffectsEl.checked,
      showPositions: showPositionsEl.checked,
      showHeatmap: showHeatmapEl.checked,
      skipFreeze: skipFreezeEl.checked,
      autoAdvance: autoAdvanceEl.checked,
      autoZoom: autoZoomEl.checked,
      perfMode: perfModeEl.checked,
    },
  };
  downloadSessionEnvelope(envelope, data.mapName || "demo");
});

sessionImportInput.addEventListener("change", async () => {
  const file = sessionImportInput.files?.[0];
  sessionImportInput.value = "";
  if (!file) return;
  errorEl.hidden = true;
  try {
    const envelope = await importSessionFile(file);
    await applyDemoPayload(envelope.demoData, { kind: "session", label: file.name });
    commentStore.loadFromJSON(envelope.comments);
    coachStore.loadFromJSON(envelope.coachDrawings);
    const s = envelope.playbackSettings;
    playSpeed = s.playSpeed;
    speedBtns.forEach((b) => b.classList.toggle("speed-btn--active", Number(b.dataset.speed) === s.playSpeed));
    showShotsEl.checked = s.showShots;
    showUtilitiesEl.checked = s.showUtilities;
    showEffectsEl.checked = s.showEffects;
    showPositionsEl.checked = s.showPositions;
    showHeatmapEl.checked = s.showHeatmap;
    skipFreezeEl.checked = s.skipFreeze;
    skipFreezeOnRoundNav = s.skipFreeze;
    autoAdvanceEl.checked = s.autoAdvance;
    autoAdvance = s.autoAdvance;
    autoZoomEl.checked = s.autoZoom;
    perfModeEl.checked = s.perfMode;
    perfMode = s.perfMode;
    updateViewportMode();
    render();
  } catch (e) {
    errorEl.hidden = false;
    errorEl.textContent = e instanceof Error ? e.message : "Failed to import session file.";
  }
});

async function fillDemoSelect(): Promise<void> {
  type Entry = { label: string; url: string };
  let demos: Entry[] = [{ label: "Bundled — demo-data.json", url: "/demo-data.json" }];
  try {
    const res = await fetch("/demos-index.json");
    if (res.ok) {
      const j: unknown = await res.json();
      if (j && typeof j === "object" && Array.isArray((j as { demos?: unknown }).demos)) {
        const parsed: Entry[] = [];
        for (const item of (j as { demos: unknown[] }).demos) {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          if (typeof o.url === "string" && typeof o.label === "string") {
            parsed.push({ label: o.label, url: o.url });
          }
        }
        if (parsed.length > 0) demos = parsed;
      }
    }
  } catch {
    /* keep default list */
  }
  demoUrlSelect.innerHTML = demos
    .map(
      (d) =>
        `<option value="${escapeAttr(d.url)}">${escapeHtml(d.label)}</option>`,
    )
    .join("");
}

async function initDemoPicker(): Promise<void> {
  await fillDemoSelect();
  populateRecentDemosList();
  legendHelpEl.innerHTML =
    '<div class="legend-note"><strong>.dem → JSON</strong> runs in the dev server (<code>npm run dev</code>) via <strong>Export & load</strong>. Pre-built <code>vite preview</code> / static hosting has no parser.<br/><br/><strong>Bundled</strong> and <strong>JSON file</strong> work offline.</div>';
  render();
}

function setMetaLine(): void {
  if (!data) return;
  const shotN = data.shots?.length ?? 0;
  const utilN = data.utilities?.length ?? 0;
  const exportHint =
    shotN === 0 && utilN === 0 ? " · no weapon_fire rows — run npm run export-demo" : "";
  const layoutHint = usingOverview()
    ? " · map PNG ✓"
    : overviewCfg
      ? ` · no map PNG`
      : " · bbox mode";
  metaEl.textContent = `${data.mapName} · ${data.demoPath} · tick sample ${data.tickStep} · ${shotN} gunshots · ${utilN} utility throws${layoutHint}${exportHint}`;
}

initDemoPicker();
