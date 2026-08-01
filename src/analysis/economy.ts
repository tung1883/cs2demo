import type { DemoData, FramePlayerRow } from "../demoTypes";
import { WEAPON_PRICE, UTILITY_PRICE } from "../utils/weapon";

export type BuyType = "pistol" | "eco" | "semi" | "force" | "full";

export type EconomyRoundRow = {
  round: number;
  team: number;
  startCash: number;
  equipValue: number;
  buyType: BuyType;
  won: boolean | undefined;
};

export type BuyTypeSummary = {
  buyType: BuyType;
  roundsWon: number;
  roundsLost: number;
};

/**
 * Approximate equipment value from a frame row's gun/utils/hasBomb fields.
 * Armor is untracked (no export field) — this under-counts vs a true buy
 * value, but is only ever used for relative economy-bucket comparisons.
 */
export function estimateEquipValue(row: FramePlayerRow): number {
  const gun = typeof row[6] === "string" ? row[6] : "";
  const utilsStr = typeof row[7] === "string" ? row[7] : "";
  let value = WEAPON_PRICE[gun] ?? 0;
  if (utilsStr) {
    for (const label of utilsStr.split(" · ")) {
      value += UTILITY_PRICE[label] ?? 0;
    }
  }
  return value;
}

const BUY_THRESHOLDS = { eco: 2000, semi: 10000, force: 20000 };

/**
 * Buckets a team-round by its (alive-count-normalized to 5) total equip
 * value. Pistol rounds are classified structurally, not by cash — see
 * `computePistolRounds`.
 */
export function classifyBuyType(
  teamEquipValue: number,
  aliveCount: number,
  isPistolRound: boolean,
): BuyType {
  if (isPistolRound) return "pistol";
  const normalized = teamEquipValue * (5 / Math.max(1, aliveCount || 5));
  if (normalized < BUY_THRESHOLDS.eco) return "eco";
  if (normalized < BUY_THRESHOLDS.semi) return "semi";
  if (normalized < BUY_THRESHOLDS.force) return "force";
  return "full";
}

/**
 * Round 0 and the halfway point of the match are pistol rounds. Structural,
 * not cash-based, since a $800 starting-cash round would otherwise
 * misclassify as Eco. DemoData carries no match-format (MR12/MR15) field,
 * so "halfway" is derived from rounds played so far — a simplification that
 * can misfire on overtime; acceptable for this heuristic.
 */
export function computePistolRounds(totalRounds: number): Set<number> {
  const rounds = new Set<number>([0]);
  if (totalRounds > 1) rounds.add(Math.floor(totalRounds / 2));
  return rounds;
}

export function buildEconomyReport(data: DemoData): EconomyRoundRow[] {
  const roundStartTick = new Map<number, number>();
  for (const [tick, round] of data.roundClockStarts ?? []) {
    if (!roundStartTick.has(round)) roundStartTick.set(round, tick);
  }

  const snapshotFrameByRound = new Map<number, FramePlayerRow[]>();
  for (const [tick, round, players] of data.frames) {
    if (snapshotFrameByRound.has(round)) continue;
    const startTick = roundStartTick.get(round);
    if (startTick !== undefined && tick >= startTick) {
      snapshotFrameByRound.set(round, players);
    }
  }

  const winnerByRound = new Map<number, number>();
  for (const [, round, winnerTeam] of data.roundResults ?? []) {
    winnerByRound.set(round, winnerTeam);
  }

  const pistolRounds = computePistolRounds(data.roundResults?.length ?? snapshotFrameByRound.size);

  const rows: EconomyRoundRow[] = [];
  for (const [round, players] of snapshotFrameByRound) {
    const byTeam = new Map<number, FramePlayerRow[]>();
    for (const row of players) {
      const team = Number(row[4]);
      const arr = byTeam.get(team) ?? [];
      arr.push(row);
      byTeam.set(team, arr);
    }
    const isPistol = pistolRounds.has(round);
    for (const [team, teamPlayers] of byTeam) {
      if (team !== 2 && team !== 3) continue;
      let startCash = 0;
      let equipValue = 0;
      for (const row of teamPlayers) {
        const balRaw = row[5];
        const bal = typeof balRaw === "number" ? balRaw : Number(balRaw);
        if (Number.isFinite(bal) && bal >= 0) startCash += bal;
        equipValue += estimateEquipValue(row);
      }
      const buyType = classifyBuyType(equipValue, teamPlayers.length, isPistol);
      const winnerTeam = winnerByRound.get(round);
      rows.push({
        round,
        team,
        startCash,
        equipValue,
        buyType,
        won: winnerTeam === undefined ? undefined : winnerTeam === team,
      });
    }
  }

  return rows.sort((a, b) => a.round - b.round || a.team - b.team);
}

export function summarizeByBuyType(report: EconomyRoundRow[]): BuyTypeSummary[] {
  const byType = new Map<BuyType, { won: number; lost: number }>();
  for (const row of report) {
    if (row.won === undefined) continue;
    const cur = byType.get(row.buyType) ?? { won: 0, lost: 0 };
    if (row.won) cur.won++;
    else cur.lost++;
    byType.set(row.buyType, cur);
  }
  const order: BuyType[] = ["pistol", "eco", "semi", "force", "full"];
  return order
    .filter((t) => byType.has(t))
    .map((buyType) => ({
      buyType,
      roundsWon: byType.get(buyType)!.won,
      roundsLost: byType.get(buyType)!.lost,
    }));
}
