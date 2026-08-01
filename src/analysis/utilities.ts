import type { DemoData } from "../demoTypes";
import { MAX_BLIND_DURATION_SEC } from "../utils/flash";

export type ThrowStats = {
  playerIdx: number;
  thrown: number;
};

export type FlashPlayerStats = {
  playerIdx: number;
  thrown: number;
  enemiesBlinded: number;
  avgDurationSec: number;
  blindedPerThrow: number;
  blindedPerRound: number;
};

export type FlashMatrixCell = {
  flasherIdx: number;
  victimIdx: number;
  totalSec: number;
};

export type FlashImpactRow = {
  flasherIdx: number;
  /** Enemies this player blinded who died while still blind (real payoff, not raw duration). */
  killsFromBlinds: number;
};

export type DamagePlayerStats = {
  playerIdx: number;
  heDamage: number;
  molotovDamage: number;
  utilityKills: number;
};

/** Grenade-throw counts per player, from `data.utilities` (weapon_fire filtered to throwables at export). */
export function buildThrowStats(data: DemoData, weaponSlug: string): ThrowStats[] {
  const counts = new Map<number, number>();
  for (const u of data.utilities ?? []) {
    const [, , , idx, weapon] = u;
    if (weapon !== weaponSlug) continue;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  return [...counts.entries()].map(([playerIdx, thrown]) => ({ playerIdx, thrown }));
}

const CORRELATION_WINDOW_SEC = 2;

/**
 * `flashVictims` (tick, victimIdx, amt) has no thrower — correlate each blind
 * to the most recent `flashPops` (tick, x, y, thrower) within
 * `CORRELATION_WINDOW_SEC`. Approximation: when multiple flashes land near-
 * simultaneously this can misattribute a blind to the wrong thrower.
 */
export function buildFlashMatrix(data: DemoData): FlashMatrixCell[] {
  const tickRate = data.tickRate || 64;
  const windowTicks = CORRELATION_WINDOW_SEC * tickRate;
  const pops = [...(data.flashPops ?? [])].sort((a, b) => a[0] - b[0]);

  const totals = new Map<string, number>();
  for (const [tick, victimIdx, amt] of data.flashVictims ?? []) {
    let best: (typeof pops)[number] | undefined;
    for (const pop of pops) {
      if (pop[0] > tick) break;
      if (tick - pop[0] > windowTicks) continue;
      best = pop;
    }
    if (!best) continue;
    const flasherIdx = best[3];
    if (flasherIdx < 0) continue;
    const key = `${flasherIdx}_${victimIdx}`;
    totals.set(key, (totals.get(key) ?? 0) + amt * MAX_BLIND_DURATION_SEC);
  }

  return [...totals.entries()].map(([key, totalSec]) => {
    const [flasherIdx, victimIdx] = key.split("_").map(Number);
    return { flasherIdx, victimIdx, totalSec };
  });
}

export function buildFlashStats(data: DemoData): FlashPlayerStats[] {
  const thrownByPlayer = new Map(buildThrowStats(data, "flashbang").map((t) => [t.playerIdx, t.thrown]));
  const matrix = buildFlashMatrix(data);
  const teamOf = new Map(data.players.map((p) => [p.i, p.team]));
  const totalRounds = new Set((data.roundClockStarts ?? []).map(([, r]) => r)).size || 1;

  const byFlasher = new Map<number, { enemiesBlinded: number; totalSec: number }>();
  for (const cell of matrix) {
    const flasherTeam = teamOf.get(cell.flasherIdx);
    const victimTeam = teamOf.get(cell.victimIdx);
    if (flasherTeam === undefined || victimTeam === undefined || flasherTeam === victimTeam) continue;
    const cur = byFlasher.get(cell.flasherIdx) ?? { enemiesBlinded: 0, totalSec: 0 };
    cur.enemiesBlinded += 1;
    cur.totalSec += cell.totalSec;
    byFlasher.set(cell.flasherIdx, cur);
  }

  const playerIdxs = new Set([...thrownByPlayer.keys(), ...byFlasher.keys()]);
  return [...playerIdxs].map((playerIdx) => {
    const thrown = thrownByPlayer.get(playerIdx) ?? 0;
    const b = byFlasher.get(playerIdx);
    const enemiesBlinded = b?.enemiesBlinded ?? 0;
    return {
      playerIdx,
      thrown,
      enemiesBlinded,
      avgDurationSec: enemiesBlinded > 0 ? (b?.totalSec ?? 0) / enemiesBlinded : 0,
      blindedPerThrow: thrown > 0 ? enemiesBlinded / thrown : 0,
      blindedPerRound: enemiesBlinded / totalRounds,
    };
  });
}

/** Enemies blinded who died while still inside their active-blind window — the real payoff of a flash, not raw duration. */
export function buildFlashImpact(data: DemoData): FlashImpactRow[] {
  const tickRate = data.tickRate || 64;
  const matrix = buildFlashMatrix(data);
  // Rebuild per-victim blind windows (tick..tick+durationTicks) since the matrix
  // only carries aggregated totals — re-scan flashVictims for windows.
  const windowsByVictim = new Map<number, { start: number; end: number }[]>();
  for (const [tick, victimIdx, amt] of data.flashVictims ?? []) {
    const durTicks = amt * MAX_BLIND_DURATION_SEC * tickRate;
    const arr = windowsByVictim.get(victimIdx) ?? [];
    arr.push({ start: tick, end: tick + durTicks });
    windowsByVictim.set(victimIdx, arr);
  }

  const killsFromBlinds = new Map<number, number>();
  for (const k of data.kills ?? []) {
    const [killTick, , , victimIdx] = k;
    const windows = windowsByVictim.get(victimIdx);
    if (!windows?.some((w) => killTick >= w.start && killTick <= w.end)) continue;
    // Matrix cells are aggregated per (flasher, victim) with no per-event tick,
    // so attribute to whichever flasher contributed the most total blind time on this victim.
    let flasherIdx = -1;
    let bestSec = 0;
    for (const cell of matrix) {
      if (cell.victimIdx !== victimIdx) continue;
      if (cell.totalSec > bestSec) {
        flasherIdx = cell.flasherIdx;
        bestSec = cell.totalSec;
      }
    }
    if (flasherIdx < 0) continue;
    killsFromBlinds.set(flasherIdx, (killsFromBlinds.get(flasherIdx) ?? 0) + 1);
  }

  return [...killsFromBlinds.entries()].map(([flasherIdx, killsFromBlindsCount]) => ({
    flasherIdx,
    killsFromBlinds: killsFromBlindsCount,
  }));
}

/** Returns `null` when `data.damages` is absent — triggers the UI's "re-export to enable" empty state. */
export function buildDamageStats(data: DemoData): DamagePlayerStats[] | null {
  if (!data.damages) return null;
  const byPlayer = new Map<number, DamagePlayerStats>();
  const get = (idx: number) => {
    const cur = byPlayer.get(idx) ?? { playerIdx: idx, heDamage: 0, molotovDamage: 0, utilityKills: 0 };
    byPlayer.set(idx, cur);
    return cur;
  };
  for (const [, , attackerIdx, , weapon, dmg] of data.damages) {
    if (attackerIdx < 0) continue;
    if (weapon === "hegrenade") get(attackerIdx).heDamage += dmg;
    else if (weapon === "molotov" || weapon === "incgrenade") get(attackerIdx).molotovDamage += dmg;
  }
  for (const [, , attackerIdx, , weapon] of data.kills ?? []) {
    if (attackerIdx < 0) continue;
    if (weapon === "hegrenade" || weapon === "molotov" || weapon === "incgrenade") {
      get(attackerIdx).utilityKills += 1;
    }
  }
  return [...byPlayer.values()].filter((r) => r.heDamage > 0 || r.molotovDamage > 0 || r.utilityKills > 0);
}
