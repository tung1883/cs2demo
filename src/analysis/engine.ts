/**
 * Statistical analysis engine for CS2 demo data.
 * Produces per-player and team-level insights from frames + kill events.
 */
import type { DemoData } from "../demoTypes";
import type { BoundingBox } from "../utils/coords";
import { MAP_POSITIONS, getPositionName, getFloorLabel, FLOOR_SPLIT_Z } from "../mapPositions";

export type AreaStat = { area: string; ticks: number; pct: number };
export type WeaponStat = { weapon: string; count: number };

export type KillLocation = {
  x: number;
  y: number;
  area: string;
  weapon: string;
  headshot: boolean;
};

export type PlayerStats = {
  idx: number;
  name: string;
  team: number;
  roundsPlayed: number;

  kills: number;
  deaths: number;
  kdRatio: number;
  headshotKills: number;
  headshotPct: number;

  favoriteWeapon: string | null;
  weaponKills: WeaponStat[];

  topAreas: AreaStat[];
  deathAreas: AreaStat[];
  killAreas: AreaStat[];
  killLocations: KillLocation[];
  deathLocations: KillLocation[];

  avgKillTimeSec: number;
  earlyPct: number;
  midPct: number;
  latePct: number;

  /** Seconds after round start when this player first fires each round (avg / std dev) */
  firstShotAvgSec: number;
  firstShotStdDev: number;
  firstShotSamples: number;
  /** Seconds after round start when this player dies each round (avg / std dev) */
  deathTimingAvgSec: number;
  deathTimingStdDev: number;
  deathTimingSamples: number;

  smokes: number;
  flashes: number;
  hes: number;
  molotovs: number;
};

export type TeamStats = {
  team: number;
  roundsWon: number;
  roundsLost: number;
  bombsPlanted: number;
  bombsDefused: number;
  bombsExploded: number;
  commonAreas: AreaStat[];
  /** Seconds after round start of the team's first engagement (kill) each round */
  firstEngagementAvgSec: number;
  firstEngagementStdDev: number;
  firstEngagementSamples: number;
};

export type HeatmapData = {
  grid: Float32Array;
  gridW: number;
  gridH: number;
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;
};

export type DemoAnalysis = {
  totalRounds: number;
  players: PlayerStats[];
  teams: TeamStats[];
  /** Alias for `heatmapsDwell`, kept for existing callers. */
  heatmaps: Map<number, HeatmapData>;
  heatmapsDwell: Map<number, HeatmapData>;
  heatmapsCoverage: Map<number, HeatmapData>;
  /** Present only for maps with a configured floor split (`FLOOR_SPLIT_Z`) and demos exported with Z data. */
  heatmapsByFloor: Map<number, Map<"Upper" | "Lower", HeatmapData>>;
  insights: string[];
};

// Round timing thresholds (seconds from round start)
const EARLY_CUTOFF = 40;
const LATE_CUTOFF = 75;

function countMap<K>(m: Map<K, number>, k: K, inc = 1): void {
  m.set(k, (m.get(k) ?? 0) + inc);
}

function topN<K>(m: Map<K, number>, n: number): { key: K; count: number }[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function mean(vals: number[]): number {
  if (!vals.length) return -1;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
}

export type HeatmapMode = "dwell" | "coverage";

/**
 * "dwell" = raw per-tick histogram (a player standing still dominates the map).
 * "coverage" = each (round, cell) counts once, regardless of how long they stood
 * there — de-duplicated per round so camping doesn't dominate over rotations.
 */
function buildHeatmap(
  positions: [number, number, number, number | null][],
  bbox: BoundingBox,
  mode: HeatmapMode,
): HeatmapData {
  const W = 64;
  const H = 64;
  const grid = new Float32Array(W * H);
  const pad = bbox.pad;
  const worldMinX = bbox.minX - pad;
  const worldMaxX = bbox.maxX + pad;
  const worldMinY = bbox.minY - pad;
  const worldMaxY = bbox.maxY + pad;
  const spanX = worldMaxX - worldMinX || 1;
  const spanY = worldMaxY - worldMinY || 1;

  const seenCoverageCells = mode === "coverage" ? new Set<string>() : null;

  for (const [x, y, round] of positions) {
    const gx = Math.floor(((x - worldMinX) / spanX) * W);
    const gy = Math.floor(((y - worldMinY) / spanY) * H);
    if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
    if (seenCoverageCells) {
      const key = `${round}_${gx}_${gy}`;
      if (seenCoverageCells.has(key)) continue;
      seenCoverageCells.add(key);
    }
    grid[gy * W + gx] += 1;
  }

  const max = Math.max(...grid);
  if (max > 0) {
    for (let i = 0; i < grid.length; i++) grid[i] /= max;
  }

  return { grid, gridW: W, gridH: H, worldMinX, worldMaxX, worldMinY, worldMaxY };
}

export function analyzeDemo(data: DemoData, bbox: BoundingBox): DemoAnalysis {
  const mapName = data.mapName;
  const tickRate = data.tickRate || 64;

  // Build round-start tick lookup: round → live start tick
  const roundStartTick = new Map<number, number>();
  for (const [tick, round] of data.roundClockStarts ?? []) {
    if (!roundStartTick.has(round)) roundStartTick.set(round, tick);
  }
  const totalRounds = roundStartTick.size;

  // Per-player accumulators
  const playerAreaTicks = new Map<number, Map<string, number>>();
  const playerTotalLiveTicks = new Map<number, number>();
  const playerPositions = new Map<number, [number, number, number, number | null][]>();
  const playerRoundsActive = new Map<number, Set<number>>();

  // Skip this long after round-live-start when sampling heatmap positions —
  // early-round spawn/buy clustering otherwise dominates the map over actual
  // rotations/duels.
  const HEATMAP_SKIP_SEC = 20;

  for (const [tick, round, players] of data.frames) {
    const liveTick = roundStartTick.get(round);
    if (liveTick === undefined) continue;
    const elapsedSec = (tick - liveTick) / tickRate;
    const pastHeatmapWindow = elapsedSec >= HEATMAP_SKIP_SEC;

    for (const pl of players) {
      const idx = Number(pl[0]);
      const x = Number(pl[1]);
      const y = Number(pl[2]);

      const area = getPositionName(mapName, x, y);

      const aMap = playerAreaTicks.get(idx) ?? new Map<string, number>();
      if (area) countMap(aMap, area);
      playerAreaTicks.set(idx, aMap);

      playerTotalLiveTicks.set(idx, (playerTotalLiveTicks.get(idx) ?? 0) + 1);

      if (pastHeatmapWindow) {
        const pos = playerPositions.get(idx) ?? [];
        const z = pl.length >= 10 ? Number(pl[9]) : null;
        pos.push([x, y, round, Number.isFinite(z) ? (z as number) : null]);
        playerPositions.set(idx, pos);
      }

      const rounds = playerRoundsActive.get(idx) ?? new Set<number>();
      rounds.add(round);
      playerRoundsActive.set(idx, rounds);
    }
  }

  // Kill stats per player
  const playerKills = new Map<number, number>();
  const playerDeaths = new Map<number, number>();
  const playerHSKills = new Map<number, number>();
  const playerWeaponKills = new Map<number, Map<string, number>>();
  const playerKillAreas = new Map<number, Map<string, number>>();
  const playerDeathAreas = new Map<number, Map<string, number>>();
  const playerKillLocs = new Map<number, KillLocation[]>();
  const playerDeathLocs = new Map<number, KillLocation[]>();
  const playerKillTimes = new Map<number, number[]>();
  /** Round-offset seconds when each player dies */
  const playerDeathTimes = new Map<number, number[]>();
  /** Per team per round: first kill offset seconds (round → sec) */
  const teamFirstEngagementByRound = new Map<number, Map<number, number>>();

  for (const k of data.kills ?? []) {
    const [killTick, round, attackerIdx, victimIdx, weapon, headshot, vX, vY] = k;
    const deathArea = getPositionName(mapName, vX, vY) ?? "Unknown";

    // victim
    countMap(playerDeaths, victimIdx);
    const dAreas = playerDeathAreas.get(victimIdx) ?? new Map<string, number>();
    countMap(dAreas, deathArea);
    playerDeathAreas.set(victimIdx, dAreas);
    const dLocs = playerDeathLocs.get(victimIdx) ?? [];
    dLocs.push({ x: vX, y: vY, area: deathArea, weapon, headshot: headshot === 1 });
    playerDeathLocs.set(victimIdx, dLocs);

    if (attackerIdx < 0) continue; // world kill (fall, etc.)

    // attacker
    countMap(playerKills, attackerIdx);
    if (headshot === 1) countMap(playerHSKills, attackerIdx);

    const wpMap = playerWeaponKills.get(attackerIdx) ?? new Map<string, number>();
    countMap(wpMap, weapon);
    playerWeaponKills.set(attackerIdx, wpMap);

    const kAreas = playerKillAreas.get(attackerIdx) ?? new Map<string, number>();
    countMap(kAreas, deathArea);
    playerKillAreas.set(attackerIdx, kAreas);

    const kLocs = playerKillLocs.get(attackerIdx) ?? [];
    kLocs.push({ x: vX, y: vY, area: deathArea, weapon, headshot: headshot === 1 });
    playerKillLocs.set(attackerIdx, kLocs);

    const liveStart = roundStartTick.get(round);
    if (liveStart !== undefined) {
      const secOffset = Math.max(0, (killTick - liveStart) / tickRate);

      // death timing for victim
      const dTimes = playerDeathTimes.get(victimIdx) ?? [];
      dTimes.push(secOffset);
      playerDeathTimes.set(victimIdx, dTimes);

      if (attackerIdx >= 0) {
        // kill timing for attacker
        const times = playerKillTimes.get(attackerIdx) ?? [];
        times.push(secOffset);
        playerKillTimes.set(attackerIdx, times);

        // first engagement per round per team (only the earliest kill this round)
        const attackerTeam = data.players.find((p) => p.i === attackerIdx)?.team;
        if (attackerTeam === 2 || attackerTeam === 3) {
          const byRound = teamFirstEngagementByRound.get(attackerTeam) ?? new Map<number, number>();
          if (!byRound.has(round) || secOffset < byRound.get(round)!) {
            byRound.set(round, secOffset);
          }
          teamFirstEngagementByRound.set(attackerTeam, byRound);
        }
      }
    }
  }

  // First-shot timing per player per round (from weapon_fire events)
  const playerFirstShotByRound = new Map<number, Map<number, number>>();
  for (const s of data.shots ?? []) {
    const shotTick = s[0];
    const playerIdx = Number(s[3]);
    // find which live round this shot belongs to
    let shotRound = -1;
    let liveStart = -1;
    // binary search equivalent: find the latest round whose liveStart <= shotTick
    for (const [round, startTick] of roundStartTick) {
      if (startTick <= shotTick && startTick > liveStart) {
        liveStart = startTick;
        shotRound = round;
      }
    }
    if (shotRound < 0 || liveStart < 0) continue;
    const secOffset = (shotTick - liveStart) / tickRate;
    if (secOffset < 0 || secOffset > 115) continue;
    const byRound = playerFirstShotByRound.get(playerIdx) ?? new Map<number, number>();
    if (!byRound.has(shotRound) || secOffset < byRound.get(shotRound)!) {
      byRound.set(shotRound, secOffset);
    }
    playerFirstShotByRound.set(playerIdx, byRound);
  }

  // Utility throws per player
  const playerSmokes = new Map<number, number>();
  const playerFlashes = new Map<number, number>();
  const playerHEs = new Map<number, number>();
  const playerMolotovs = new Map<number, number>();

  for (const u of data.utilities ?? []) {
    const idx = Number(u[3]);
    const weapon = String(u[4] ?? "");
    if (weapon.includes("smoke")) countMap(playerSmokes, idx);
    else if (weapon.includes("flash")) countMap(playerFlashes, idx);
    else if (weapon.includes("hegrenade") || weapon.includes("he")) countMap(playerHEs, idx);
    else if (weapon.includes("molotov") || weapon.includes("incgrenade")) countMap(playerMolotovs, idx);
  }

  // Build per-player stats
  const playerStatsList: PlayerStats[] = data.players.map((p) => {
    const total = playerTotalLiveTicks.get(p.i) ?? 1;
    const aMap = playerAreaTicks.get(p.i) ?? new Map<string, number>();
    const topAreas: AreaStat[] = topN(aMap, 6).map(({ key, count }) => ({
      area: key,
      ticks: count,
      pct: count / total,
    }));

    const kills = playerKills.get(p.i) ?? 0;
    const deaths = playerDeaths.get(p.i) ?? 0;
    const hsKills = playerHSKills.get(p.i) ?? 0;
    const wpMap = playerWeaponKills.get(p.i) ?? new Map<string, number>();
    const weaponKills: WeaponStat[] = topN(wpMap, 5).map(({ key, count }) => ({
      weapon: key,
      count,
    }));

    const kAreaMap = playerKillAreas.get(p.i) ?? new Map<string, number>();
    const killAreas: AreaStat[] = topN(kAreaMap, 5).map(({ key, count }) => ({
      area: key,
      ticks: count,
      pct: kills > 0 ? count / kills : 0,
    }));

    const dAreaMap = playerDeathAreas.get(p.i) ?? new Map<string, number>();
    const deathAreas: AreaStat[] = topN(dAreaMap, 5).map(({ key, count }) => ({
      area: key,
      ticks: count,
      pct: deaths > 0 ? count / deaths : 0,
    }));

    const killTimes = playerKillTimes.get(p.i) ?? [];
    const avgKillTimeSec =
      killTimes.length > 0
        ? killTimes.reduce((a, b) => a + b, 0) / killTimes.length
        : -1;
    const early = killTimes.filter((t) => t < EARLY_CUTOFF).length;
    const late = killTimes.filter((t) => t >= LATE_CUTOFF).length;
    const mid = killTimes.length - early - late;
    const n = killTimes.length || 1;

    // First-shot timing per round
    const firstShotTimes = [...(playerFirstShotByRound.get(p.i)?.values() ?? [])];
    const firstShotAvgSec = mean(firstShotTimes);
    const firstShotStdDev = stdDev(firstShotTimes);

    // Death timing per round
    const dTimes = playerDeathTimes.get(p.i) ?? [];
    const deathTimingAvgSec = mean(dTimes);
    const deathTimingStdDev = stdDev(dTimes);

    return {
      idx: p.i,
      name: p.name,
      team: p.team,
      roundsPlayed: playerRoundsActive.get(p.i)?.size ?? 0,
      kills,
      deaths,
      kdRatio: deaths > 0 ? kills / deaths : kills,
      headshotKills: hsKills,
      headshotPct: kills > 0 ? (hsKills / kills) * 100 : 0,
      favoriteWeapon: weaponKills[0]?.weapon ?? null,
      weaponKills,
      topAreas,
      killAreas,
      deathAreas,
      killLocations: playerKillLocs.get(p.i) ?? [],
      deathLocations: playerDeathLocs.get(p.i) ?? [],
      avgKillTimeSec,
      earlyPct: (early / n) * 100,
      midPct: (mid / n) * 100,
      latePct: (late / n) * 100,
      firstShotAvgSec,
      firstShotStdDev,
      firstShotSamples: firstShotTimes.length,
      deathTimingAvgSec,
      deathTimingStdDev,
      deathTimingSamples: dTimes.length,
      smokes: playerSmokes.get(p.i) ?? 0,
      flashes: playerFlashes.get(p.i) ?? 0,
      hes: playerHEs.get(p.i) ?? 0,
      molotovs: playerMolotovs.get(p.i) ?? 0,
    };
  });

  // Team stats
  const teamRoundsWon = new Map<number, number>();
  for (const [, , winnerTeam] of data.roundResults ?? []) {
    if (winnerTeam === 2 || winnerTeam === 3) {
      countMap(teamRoundsWon, winnerTeam);
    }
  }

  const teamsPresent = new Set(data.players.map((p) => p.team).filter((t) => t === 2 || t === 3));
  const teamStatsList: TeamStats[] = [...teamsPresent].map((team) => {
    const teamPlayers = data.players.filter((p) => p.team === team);
    const teamAreaAccum = new Map<string, number>();
    for (const p of teamPlayers) {
      const aMap = playerAreaTicks.get(p.i) ?? new Map<string, number>();
      for (const [area, count] of aMap) {
        countMap(teamAreaAccum, area, count);
      }
    }
    const totalTeamTicks = [...teamAreaAccum.values()].reduce((a, b) => a + b, 0) || 1;
    const commonAreas: AreaStat[] = topN(teamAreaAccum, 8).map(({ key, count }) => ({
      area: key,
      ticks: count,
      pct: count / totalTeamTicks,
    }));

    const won = teamRoundsWon.get(team) ?? 0;
    const lost = teamRoundsWon.get(team === 2 ? 3 : 2) ?? 0;

    const engTimes = [...(teamFirstEngagementByRound.get(team)?.values() ?? [])];
    const firstEngagementAvgSec = mean(engTimes);
    const firstEngagementStdDev = stdDev(engTimes);

    return {
      team,
      roundsWon: won,
      roundsLost: lost,
      bombsPlanted: team === 2 ? (data.bombPlants?.length ?? 0) : 0,
      bombsDefused:
        team === 3
          ? (data.bombEnds?.filter((e) => e[1] === "defused").length ?? 0)
          : 0,
      bombsExploded:
        team === 2
          ? (data.bombEnds?.filter((e) => e[1] === "exploded").length ?? 0)
          : 0,
      commonAreas,
      firstEngagementAvgSec,
      firstEngagementStdDev,
      firstEngagementSamples: engTimes.length,
    };
  });

  // Per-player heatmaps (both weightings computed eagerly — cheap, 64×64 float grids)
  const heatmapsDwell = new Map<number, HeatmapData>();
  const heatmapsCoverage = new Map<number, HeatmapData>();
  for (const p of data.players) {
    const pos = playerPositions.get(p.i);
    if (pos && pos.length > 10) {
      heatmapsDwell.set(p.i, buildHeatmap(pos, bbox, "dwell"));
      heatmapsCoverage.set(p.i, buildHeatmap(pos, bbox, "coverage"));
    }
  }

  // Per-floor heatmaps — only for maps with a configured split, and only when this
  // export actually carries Z data (older JSON without it has every z === null).
  const heatmapsByFloor = new Map<number, Map<"Upper" | "Lower", HeatmapData>>();
  if (FLOOR_SPLIT_Z[mapName] !== undefined) {
    for (const p of data.players) {
      const pos = playerPositions.get(p.i);
      if (!pos?.length) continue;
      const byFloor = new Map<"Upper" | "Lower", typeof pos>();
      for (const row of pos) {
        const z = row[3];
        if (z === null) continue;
        const floor = getFloorLabel(mapName, z);
        if (!floor) continue;
        const arr = byFloor.get(floor) ?? [];
        arr.push(row);
        byFloor.set(floor, arr);
      }
      if (!byFloor.size) continue;
      const grids = new Map<"Upper" | "Lower", HeatmapData>();
      for (const [floor, floorPos] of byFloor) {
        if (floorPos.length > 10) grids.set(floor, buildHeatmap(floorPos, bbox, "dwell"));
      }
      if (grids.size) heatmapsByFloor.set(p.i, grids);
    }
  }

  const insights = generateInsights(playerStatsList, teamStatsList, totalRounds, data);

  return {
    totalRounds,
    players: playerStatsList,
    teams: teamStatsList,
    heatmaps: heatmapsDwell,
    heatmapsDwell,
    heatmapsCoverage,
    heatmapsByFloor,
    insights,
  };
}

function sec(s: number): string {
  return `${s.toFixed(0)}s`;
}

function generateInsights(
  players: PlayerStats[],
  teams: TeamStats[],
  totalRounds: number,
  data: DemoData,
): string[] {
  const insights: string[] = [];

  // ── Per-player insights ────────────────────────────────────────────────────
  for (const p of players) {
    if (p.kills + p.deaths === 0) continue;

    // K/D
    if (p.kdRatio >= 2) {
      insights.push(`[STRENGTH] ${p.name}: K/D ${p.kdRatio.toFixed(2)} — dominant in duels.`);
    } else if (p.kdRatio <= 0.5 && p.deaths > 2) {
      insights.push(`[WEAKNESS] ${p.name}: K/D ${p.kdRatio.toFixed(2)} — losing most duels, likely taking bad fights.`);
    }

    // Headshot rate
    if (p.headshotPct >= 60 && p.kills >= 3) {
      insights.push(`[STRENGTH] ${p.name}: ${p.headshotPct.toFixed(0)}% HS rate — precise aim, punishes peekers hard.`);
    }

    // Positioning
    if (p.topAreas.length > 0) {
      const top = p.topAreas[0];
      if (top.pct >= 0.35) {
        insights.push(`[HABIT] ${p.name}: Anchors at ${top.area} ~${(top.pct * 100).toFixed(0)}% of rounds — very predictable default.`);
      }
    }

    // Death hotspot
    if (p.deathAreas.length > 0) {
      const dA = p.deathAreas[0];
      if (dA.ticks >= 2) {
        insights.push(`[WEAKNESS] ${p.name}: Dies most at ${dA.area} (${dA.ticks}×) — opponents are winning that duel consistently.`);
      }
    }

    // ── Timing vulnerability (first shot) ─────────────────────────────────
    if (p.firstShotSamples >= 4 && p.firstShotAvgSec >= 0) {
      const avg = p.firstShotAvgSec;
      const sd  = p.firstShotStdDev;
      if (sd <= 10) {
        // very consistent peek window — this is an exploit target
        const window = `${sec(Math.max(0, avg - sd))}–${sec(avg + sd)}`;
        insights.push(
          `[TIMING VULNERABLE] ${p.name}: First peek/shot at ${sec(avg)} ±${sd.toFixed(0)}s (${p.firstShotSamples} rounds). ` +
          `Consistent window ${window} — opponents can set up pre-aim or utility to punish.`,
        );
      } else if (sd <= 18 && avg < 30) {
        insights.push(
          `[TIMING] ${p.name}: Tends to engage early (~${sec(avg)}, ±${sd.toFixed(0)}s) — ` +
          `aggressive opener, can be baited with a fake peek.`,
        );
      } else if (avg > 75) {
        insights.push(
          `[TIMING] ${p.name}: Holds fire until ~${sec(avg)} — late-round lurker style, ` +
          `useful for trades but rarely creates openings alone.`,
        );
      }
    }

    // ── Death timing vulnerability ─────────────────────────────────────────
    if (p.deathTimingSamples >= 4 && p.deathTimingAvgSec >= 0) {
      const avg = p.deathTimingAvgSec;
      const sd  = p.deathTimingStdDev;
      const topDeathArea = p.deathAreas[0]?.area ?? "map";

      if (sd <= 12) {
        insights.push(
          `[TIMING VULNERABLE] ${p.name}: Dies at ${sec(avg)} ±${sd.toFixed(0)}s into the round ` +
          `(${p.deathTimingSamples} rounds, usually at ${topDeathArea}). ` +
          `Opponent can time utility or aggression at ~${sec(avg)} to catch them.`,
        );
      } else if (avg < 25 && p.deathTimingSamples >= 3) {
        insights.push(
          `[WEAKNESS] ${p.name}: Dying very early (~${sec(avg)} avg) — ` +
          `taking opening duels before team is ready or position is unsupported.`,
        );
      }
    }

    // Kill timing style
    if (p.kills >= 3) {
      if (p.earlyPct >= 65) {
        insights.push(`[STYLE] ${p.name}: ${p.earlyPct.toFixed(0)}% of kills before 40s — entry-fragger style, high-impact early.`);
      } else if (p.latePct >= 55) {
        insights.push(`[STYLE] ${p.name}: ${p.latePct.toFixed(0)}% of kills after 75s — lurk/clutch specialist, low early-round presence.`);
      }
    }

    // Grenade usage
    const totalGrenades = p.smokes + p.flashes + p.hes + p.molotovs;
    if (p.roundsPlayed >= 5 && totalGrenades / p.roundsPlayed < 0.5) {
      insights.push(`[WEAKNESS] ${p.name}: Only ${totalGrenades} grenades across ${p.roundsPlayed} rounds — low utility impact.`);
    }
    if (p.roundsPlayed >= 4 && p.smokes / p.roundsPlayed >= 0.8) {
      insights.push(`[STRENGTH] ${p.name}: Smoking almost every round (${p.smokes}/${p.roundsPlayed}) — reliable support.`);
    }
  }

  // ── Team-level insights ────────────────────────────────────────────────────
  for (const t of teams) {
    const label = t.team === 2 ? "T side" : "CT side";
    const total = t.roundsWon + t.roundsLost;

    if (total > 0) {
      const wr = (t.roundsWon / total) * 100;
      if (wr >= 65) {
        insights.push(`[STRENGTH] ${label}: ${t.roundsWon}/${total} rounds (${wr.toFixed(0)}%) — dominant side.`);
      } else if (wr <= 35) {
        insights.push(`[WEAKNESS] ${label}: Only ${t.roundsWon}/${total} rounds (${wr.toFixed(0)}%) — consistently losing.`);
      }
    }

    if (t.team === 2 && t.bombsPlanted > 0) {
      const convRate = t.bombsExploded / t.bombsPlanted;
      if (convRate >= 0.6) {
        insights.push(`[STRENGTH] T side converts ${(convRate * 100).toFixed(0)}% of plants — good post-plant execution.`);
      } else if (convRate <= 0.25 && t.bombsPlanted >= 3) {
        insights.push(`[WEAKNESS] T side plants (${t.bombsPlanted}×) but converts only ${(convRate * 100).toFixed(0)}% — CT side winning post-plant duels.`);
      }
    }

    // ── Team timing vulnerability ──────────────────────────────────────────
    if (t.firstEngagementSamples >= 4 && t.firstEngagementAvgSec >= 0) {
      const avg = t.firstEngagementAvgSec;
      const sd  = t.firstEngagementStdDev;
      const window = `${sec(Math.max(0, avg - sd))}–${sec(avg + sd)}`;

      if (sd <= 10 && t.team === 2) {
        insights.push(
          `[TIMING VULNERABLE] T side: First engagement at ${sec(avg)} ±${sd.toFixed(0)}s (${t.firstEngagementSamples} rounds). ` +
          `Very predictable — CT side can stack a site, pre-hold, or use utility at ~${sec(avg)} to counter the execute.`,
        );
      } else if (sd <= 10 && t.team === 3) {
        insights.push(
          `[TIMING VULNERABLE] CT side: Takes first fights at ${sec(avg)} ±${sd.toFixed(0)}s consistently. ` +
          `T side can delay to ${window} and catch them in a predictable peek.`,
        );
      } else if (avg > 80 && t.team === 2) {
        insights.push(
          `[TIMING] T side: Average first engagement at ${sec(avg)} — very slow pacing. ` +
          `Clock pressure (< 35s remaining) may force rushed, uncoordinated plays.`,
        );
      } else if (avg < 25 && t.team === 2) {
        insights.push(
          `[TIMING] T side: Consistently rushing early (~${sec(avg)} avg). ` +
          `CT side can abuse this with aggressive early contact or stacked defense.`,
        );
      }
    }
  }

  // ── Cross-player timing patterns ──────────────────────────────────────────
  // Detect if multiple players from the same team share a very similar first-shot window
  const teamPlayers = new Map<number, PlayerStats[]>();
  for (const p of players) {
    if (p.firstShotSamples < 3 || p.firstShotAvgSec < 0) continue;
    const arr = teamPlayers.get(p.team) ?? [];
    arr.push(p);
    teamPlayers.set(p.team, arr);
  }
  for (const [team, members] of teamPlayers) {
    if (members.length < 2) continue;
    const tLabel = team === 2 ? "T side" : "CT side";
    // find pairs whose avg first-shot times are within 8s of each other
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        if (Math.abs(a.firstShotAvgSec - b.firstShotAvgSec) <= 8 &&
            a.firstShotStdDev <= 14 && b.firstShotStdDev <= 14) {
          insights.push(
            `[TIMING] ${tLabel}: ${a.name} (~${sec(a.firstShotAvgSec)}) and ${b.name} (~${sec(b.firstShotAvgSec)}) ` +
            `peek at nearly the same time — predictable two-man timing that opponents can prepare for.`,
          );
        }
      }
    }
  }

  // ── Overall game pace ──────────────────────────────────────────────────────
  if (totalRounds >= 5) {
    const bombsPerRound = (data.bombPlants?.length ?? 0) / totalRounds;
    if (bombsPerRound < 0.2 && totalRounds >= 8) {
      insights.push(`[TIMING] T side plants in only ${Math.round(bombsPerRound * 100)}% of rounds — CT pressure or T passivity is keeping them off sites.`);
    }
  }

  if (insights.length === 0) {
    insights.push("Re-export the demo with the updated parser to enable kill events and timing analysis.");
  }

  return insights;
}

/** Build a heatmap for a specific player from pre-computed analysis. */
export function getPlayerHeatmap(
  analysis: DemoAnalysis,
  playerIdx: number,
  mode: HeatmapMode = "dwell",
): HeatmapData | undefined {
  const source = mode === "coverage" ? analysis.heatmapsCoverage : analysis.heatmapsDwell;
  return source.get(playerIdx);
}
