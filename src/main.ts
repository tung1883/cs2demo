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

const defaultBBox: BoundingBox = {
  minX: -2500,
  maxX: 2500,
  minY: -1500,
  maxY: 3500,
  pad: 200,
};

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
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
const demoUrlSelect = document.getElementById("demo-url-select") as HTMLSelectElement;
const demoLoadUrlBtn = document.getElementById("demo-load-url") as HTMLButtonElement;
const demoFileInput = document.getElementById("demo-file-input") as HTMLInputElement;
const demoDemInput = document.getElementById("demo-dem-input") as HTMLInputElement;
const demoExportDemBtn = document.getElementById("demo-export-dem") as HTMLButtonElement;

let data: DemoData | null = null;
let frameIndex = 0;
let playing = false;
let raf = 0;
let lastFrameTime = 0;
let playAccum = 0;

function stopPlayback(): void {
  playing = false;
  playBtn.setAttribute("aria-pressed", "false");
  playBtn.textContent = "Play";
  cancelAnimationFrame(raf);
  lastFrameTime = 0;
  playAccum = 0;
}

let bbox: BoundingBox = defaultBBox;

/** Loaded square overview PNG + matching geometry from `src/mapOverview.ts` */
let overviewCfg: MapOverviewConfig | undefined;
let overviewImage: HTMLImageElement | null = null;

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
  return { idx, x, y, yaw, team, balance, gun, utils, hasBomb };
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

function worldXYToCanvas(wx: number, wy: number): { x: number; y: number } {
  if (usingOverview()) {
    const cfg = overviewCfg!;
    const { px, py } = worldToOverviewPixel(wx, wy, cfg);
    return overviewPixelToCanvas(px, py, cfg, canvas.width, canvas.height);
  }
  return worldToCanvasBBox(wx, wy, bbox, canvas.width, canvas.height);
}

/** Approximate canvas pixels per world unit for circular FX. */
function worldRadiusToCanvasPx(rWorld: number): number {
  const cw = canvas.width;
  const ch = canvas.height;
  if (usingOverview() && overviewCfg) {
    const n = overviewCfg.overviewPx || 1024;
    const side = Math.min(cw, ch);
    return (rWorld / overviewCfg.scale) * (side / n);
  }
  const sx = bbox.maxX - bbox.minX + 2 * bbox.pad;
  const sy = bbox.maxY - bbox.minY + 2 * bbox.pad;
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
    ctx.drawImage(overviewImage, ref.ox, ref.oy, ref.side, ref.side);
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
      ctx.font = "11px Segoe UI, system-ui, sans-serif";
      ctx.fillStyle = "rgba(232,234,237,0.88)";
      ctx.fillText(name, cx + 9, cy + 4);
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
  const s = 10;
  ctx.save();
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
  ctx.restore();
}

function drawFrame(frame: Frame | undefined): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawMapLayout();
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
  timeReadout.textContent = `Round ${displayRound} · ${formatTime(roundLeft)} left${betweenNote} · tick ${tick} · demo ${formatTime(t)}`;
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
  drawFrame(data.frames[frameIndex]);
  updateReadout();
  updateBombHud(data.frames[frameIndex]);
  updateLegendRoster(data.frames[frameIndex]);
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

function tickPlayback(ts: number): void {
  if (!playing || !data) return;
  if (lastFrameTime === 0) lastFrameTime = ts;
  const dt = (ts - lastFrameTime) / 1000;
  lastFrameTime = ts;
  playAccum += dt;
  while (frameIndex < data.frames.length - 1) {
    const stepSec = secondsForFrameStep(frameIndex);
    if (playAccum < stepSec) break;
    playAccum -= stepSec;
    frameIndex += 1;
  }
  scrub.value = String(frameIndex);
  render();
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
    await applyDemoPayload(body);
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

async function applyDemoPayload(parsed: DemoData): Promise<void> {
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
  setMetaLine();
  buildLegend();
  render();
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
    await applyDemoPayload(raw);
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
    await applyDemoPayload(raw);
  } catch (e) {
    errorEl.hidden = false;
    errorEl.textContent =
      e instanceof Error ? e.message : "Failed to read demo JSON.";
  }
}

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
