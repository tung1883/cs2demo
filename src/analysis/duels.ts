import type { DemoData, KillTuple } from "../demoTypes";

export type DuelMatrixCell = {
  killerIdx: number;
  victimIdx: number;
  count: number;
};

export type OpeningDuelStats = {
  team: number;
  duelsWon: number;
  duelsLost: number;
  /** % of won opening duels where that side went on to win the round */
  conversionPct: number;
  /** % of lost opening duels where that side also lost the round */
  lostConversionPct: number;
};

const TRADE_WINDOW_SEC = 5;

/** Player x player kill counts — one pass over `data.kills`, world kills (attackerIdx < 0) excluded. */
export function buildDuelMatrix(data: DemoData): DuelMatrixCell[] {
  const counts = new Map<string, number>();
  for (const k of data.kills ?? []) {
    const [, , attackerIdx, victimIdx] = k;
    if (attackerIdx < 0) continue;
    const key = `${attackerIdx}_${victimIdx}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [killerIdx, victimIdx] = key.split("_").map(Number);
    return { killerIdx, victimIdx, count };
  });
}

/**
 * Per-round earliest kill = the "opening duel". Attacker's team wins it, victim's
 * team loses it. With `ignoreTraded`, a round's opener is excluded entirely if the
 * opening killer dies within `TRADE_WINDOW_SEC` of their kill, in the same round
 * (they were "traded back" — the entry wasn't a clean pick).
 */
export function buildOpeningDuelStats(
  data: DemoData,
  opts: { ignoreTraded: boolean },
): OpeningDuelStats[] {
  const tickRate = data.tickRate || 64;
  const tradeWindowTicks = TRADE_WINDOW_SEC * tickRate;
  const kills = data.kills ?? [];

  const byRound = new Map<number, KillTuple[]>();
  for (const k of kills) {
    const round = k[1];
    const arr = byRound.get(round) ?? [];
    arr.push(k);
    byRound.set(round, arr);
  }

  const winnerByRound = new Map<number, number>();
  for (const [, round, winnerTeam] of data.roundResults ?? []) {
    winnerByRound.set(round, winnerTeam);
  }

  const wonByTeam = new Map<number, number>();
  const lostByTeam = new Map<number, number>();
  const wonThenRoundWonByTeam = new Map<number, number>();
  const lostThenRoundLostByTeam = new Map<number, number>();

  for (const [round, roundKills] of byRound) {
    let opener: KillTuple | undefined;
    for (const k of roundKills) {
      if (k[2] < 0) continue; // world kill, no opener
      if (!opener || k[0] < opener[0]) opener = k;
    }
    if (!opener) continue;

    const [openTick, , attackerIdx, victimIdx] = opener;

    if (opts.ignoreTraded) {
      const traded = roundKills.some(
        (k) =>
          k[3] === attackerIdx &&
          k[0] > openTick &&
          k[0] - openTick <= tradeWindowTicks,
      );
      if (traded) continue;
    }

    // Attacker/victim team is read from the death-frame data at kill time via player index —
    // duels.ts has no access to per-frame team, so fall back to roster team (stable per match).
    const winnerIdx = attackerIdx;
    const loserIdx = victimIdx;
    const winnerTeam = data.players[winnerIdx]?.team;
    const loserTeam = data.players[loserIdx]?.team;
    if (winnerTeam === undefined || loserTeam === undefined) continue;

    wonByTeam.set(winnerTeam, (wonByTeam.get(winnerTeam) ?? 0) + 1);
    lostByTeam.set(loserTeam, (lostByTeam.get(loserTeam) ?? 0) + 1);

    const roundWinner = winnerByRound.get(round);
    if (roundWinner !== undefined) {
      if (roundWinner === winnerTeam) {
        wonThenRoundWonByTeam.set(
          winnerTeam,
          (wonThenRoundWonByTeam.get(winnerTeam) ?? 0) + 1,
        );
      }
      if (roundWinner !== loserTeam) {
        lostThenRoundLostByTeam.set(
          loserTeam,
          (lostThenRoundLostByTeam.get(loserTeam) ?? 0) + 1,
        );
      }
    }
  }

  const teams = new Set([...wonByTeam.keys(), ...lostByTeam.keys()]);
  return [...teams].map((team) => {
    const won = wonByTeam.get(team) ?? 0;
    const lost = lostByTeam.get(team) ?? 0;
    return {
      team,
      duelsWon: won,
      duelsLost: lost,
      conversionPct: won > 0 ? ((wonThenRoundWonByTeam.get(team) ?? 0) / won) * 100 : 0,
      lostConversionPct:
        lost > 0 ? ((lostThenRoundLostByTeam.get(team) ?? 0) / lost) * 100 : 0,
    };
  });
}
