export type PlayerMeta = {
  i: number;
  name: string;
  steamid: string;
  team: number;
};
/**
 * Per-frame player sample.
 * Legacy: [idx, x, y, yaw, team]
 * Extended: + balance (-1 unknown), gun slug, utils label, hasBomb (0|1) when exporter adds economy/C4.
 * Extended further: + Z world height (index 9) when exporter adds floor support — rows shorter
 * than 10 elements predate this and should be treated as "no floor data" (single-level heatmap only).
 */
export type FramePlayerRow = (number | string)[];
/** [tick, round, players[]] */
export type Frame = [number, number, FramePlayerRow[]];

/** Gun / utility fire: tick, X, Y, roster idx; optional weapon slug; optional user_yaw, user_pitch from weapon_fire */
export type ShotTuple =
  | [number, number, number, number]
  | [number, number, number, number, string]
  | [number, number, number, number, string, number]
  | [number, number, number, number, string, number, number];
export type UtilityTuple = ShotTuple;

/** Detonation / burn anchor: tick, world X/Y, thrower roster idx (-1 unknown) */
export type GrenadePopTuple = [number, number, number, number];

/** Bomb planted: tick, world X/Y, site code (demo-specific; -1 unknown) */
export type BombPlantTuple = [number, number, number, number];
/** Bomb round ended: tick, how */
export type BombEndTuple = [number, "exploded" | "defused"];
/** Bomb dropped on ground: tick, world X/Y (planter position at drop event) */
export type BombDropTuple = [number, number, number];

/** Flash highlight: `player_blind` tick, victim roster idx, strength 0–1 */
export type FlashVictimTuple = [number, number, number];

/**
 * player_death: [tick, round, attackerIdx(-1=world), victimIdx, weapon, headshot(0|1), victimX, victimY]
 */
export type KillTuple = [number, number, number, number, string, number, number, number];

/** round_end: [tick, round, winnerTeam(2=T|3=CT|0=unknown), reason (e.g. "bomb_defused"/"t_killed"/"ct_killed"/"time_ran_out"; "" unknown)] */
export type RoundResultTuple = [number, number, number, string];

/**
 * player_hurt: [tick, round, attackerIdx(-1=world/unknown), victimIdx, weapon, dmgHealth]
 * Zero/negative damage rows are dropped at export.
 */
export type DamageTuple = [number, number, number, number, string, number];

/** Demo tick when live round clock starts (`round_freeze_end`, paired with `round_start` in export); matches `Frame[1]` */
export type RoundClockStartTuple = [number, number];
/** Round ended (`round_end` / `round_officially_ended`); tick, round — for post-round gaps before next live clock */
export type RoundEndHudTuple = [number, number];

export type DemoData = {
  mapName: string;
  demoPath: string;
  tickRate: number;
  /** Demo tick stride between exported frames (1 = keep every tick the parser emits). */
  tickStep: number;
  players: PlayerMeta[];
  frames: Frame[];
  /** Gun shots (grenades/knives/c4 stripped at export); sorted by tick */
  shots?: ShotTuple[];
  /** Grenade throws from weapon_fire; sorted by tick — run npm run export-demo after viewer update */
  utilities?: UtilityTuple[];
  smokePops?: GrenadePopTuple[];
  hePops?: GrenadePopTuple[];
  flashPops?: GrenadePopTuple[];
  molotovPools?: GrenadePopTuple[];
  /** Flash victims from demo `player_blind` only (no geometric fallback) */
  flashVictims?: FlashVictimTuple[];
  /** Bomb planted positions / timers (from bomb_* events) */
  bombPlants?: BombPlantTuple[];
  bombEnds?: BombEndTuple[];
  bombDrops?: BombDropTuple[];
  /** Ticks when bomb was picked up — clears dropped-on-ground state */
  bombPickupTicks?: number[];
  /** When live round timer starts per round: `round_freeze_end`, paired with `round_start` when needed — re-export */
  roundClockStarts?: RoundClockStartTuple[];
  /** When each round ends for HUD (post-win delay before next live clock) — re-export */
  roundEndsHud?: RoundEndHudTuple[];
  /** Kill events from player_death — re-export to populate */
  kills?: KillTuple[];
  /** Round outcomes from round_end — re-export to populate */
  roundResults?: RoundResultTuple[];
  /** Damage events from player_hurt — re-export to populate; HE/molotov damage stats degrade to an empty state without it */
  damages?: DamageTuple[];
};
