/**
 * Browser-safe demo → viewer JSON (Uint8Array in / DemoData out).
 * Mirrors scripts/demo-buffer-to-json.mjs for WASM bindings (no Buffer / no NAPI-only APIs).
 */
import type { DemoData, KillTuple, PlayerMeta, RoundResultTuple } from "../demoTypes";

export type ExportProgressEvent = {
  phase: string;
  pct: number;
  label: string;
};

export type DemoParserBindings = {
  parseHeader: (file: Uint8Array) => { map_name?: string };
  parseTicks: (
    file: Uint8Array,
    wantedProps?: string[] | null,
    wantedTicks?: Int32Array | null,
    structOfArrays?: boolean | null,
  ) => unknown[];
  parseEvents: (
    file: Uint8Array,
    eventNames?: unknown[],
    wantedPlayerProps?: unknown[],
    wantedOtherProps?: unknown[],
  ) => unknown[];
  /** When set (Node native), roster matches CLI export. WASM omits this — roster is inferred from tick rows. */
  parsePlayerInfo?: (file: Uint8Array) => Array<{
    steamid: unknown;
    name: string;
    team_number: number;
  }>;
};

export type BuildDemoDataOptions = {
  demoPathLabel?: string;
  tickStep?: number;
  onProgress?: (e: ExportProgressEvent) => void;
  /** Yield so UI/worker can flush messages between phases (browser: setTimeout 0). */
  tickYield?: () => Promise<void>;
};

type TickRow = {
  tick: number;
  steamid?: unknown;
  X?: number;
  Y?: number;
  yaw?: unknown;
  team_num?: unknown;
  is_alive?: unknown;
  player_name?: unknown;
  game_time?: unknown;
  total_rounds_played?: unknown;
  balance?: unknown;
  money?: unknown;
  active_weapon_name?: unknown;
  inventory?: unknown;
  weapons?: unknown;
};

type DemoEvent = Record<string, unknown> & {
  tick?: unknown;
  /** Present on rows from parseEvents */
  event_name?: unknown;
  user_steamid?: unknown;
  user_X?: unknown;
  user_Y?: unknown;
  x?: unknown;
  y?: unknown;
  site?: unknown;
  weapon?: unknown;
  user_yaw?: unknown;
  user_pitch?: unknown;
  blind_duration?: unknown;
  blind_percentage?: unknown;
  total_rounds_played?: unknown;
  attacker_steamid?: unknown;
  headshot?: unknown;
  winner?: unknown;
  reason?: unknown;
};

/** Loose tuple builder for shots/utilities before casting to DemoData */
type ShotTupleLike = (string | number)[] & { 0: number };

function isUtilityThrowWeapon(weapon: unknown): boolean {
  const w = String(weapon).toLowerCase();
  if (!w.startsWith("weapon_")) return false;
  if (w.includes("knife") || w.includes("bayonet")) return false;
  return (
    w === "weapon_hegrenade" ||
    w === "weapon_flashbang" ||
    w === "weapon_smokegrenade" ||
    w === "weapon_molotov" ||
    w === "weapon_incgrenade" ||
    w === "weapon_decoy"
  );
}

function isGunFireWeapon(weapon: unknown): boolean {
  const w = String(weapon).toLowerCase();
  if (!w.startsWith("weapon_")) return false;
  if (w.includes("knife") || w.includes("bayonet")) return false;
  if (
    w === "weapon_c4" ||
    w === "weapon_healthshot" ||
    w === "weapon_hegrenade" ||
    w === "weapon_flashbang" ||
    w === "weapon_smokegrenade" ||
    w === "weapon_molotov" ||
    w === "weapon_incgrenade" ||
    w === "weapon_decoy"
  ) {
    return false;
  }
  return true;
}

function shortenWeapon(slug: unknown): string {
  return String(slug).replace(/^weapon_/, "");
}

function inventoryHasC4(inv: unknown): boolean {
  if (!Array.isArray(inv)) return false;
  return inv.some((item) => {
    const w =
      typeof item === "object" && item != null
        ? (item as { name?: unknown; weapon?: unknown; classname?: unknown })
            .name ??
          (item as { weapon?: unknown }).weapon ??
          (item as { classname?: unknown }).classname ??
          ""
        : item;
    const s = String(w).toLowerCase();
    return s.includes("c4") || s === "weapon_c4";
  });
}

function packUtilityLabels(row: TickRow): string {
  const raw = row.inventory ?? row.weapons;
  if (raw == null || raw === "") return "";
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      items = Array.isArray(j) ? j : [raw];
    } catch {
      items = raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } else if (typeof raw === "object") {
    items = Object.values(raw as object);
  }

  function labelForEntry(entry: unknown): string | null {
    const w =
      typeof entry === "object" && entry != null
        ? (entry as { weapon?: unknown; name?: unknown; classname?: unknown })
            .weapon ??
          (entry as { name?: unknown }).name ??
          (entry as { classname?: unknown }).classname ??
          ""
        : entry;
    const s = String(w).trim();
    if (!s) return null;
    const lower = s.toLowerCase();

    if (lower.startsWith("weapon_")) {
      if (!isUtilityThrowWeapon(lower)) return null;
      if (lower.includes("smoke")) return "Smoke";
      if (lower.includes("flash")) return "Flash";
      if (lower.includes("hegrenade")) return "HE";
      if (lower.includes("molotov") || lower.includes("incgrenade"))
        return "Fire";
      if (lower.includes("decoy")) return "Decoy";
      return "Util";
    }

    if (lower.includes("high explosive")) return "HE";
    if (lower.includes("smoke grenade") || lower === "smoke") return "Smoke";
    if (
      lower.includes("flashbang") ||
      lower.includes("flash grenade") ||
      lower === "flash"
    )
      return "Flash";
    if (lower.includes("molotov") || lower.includes("incendiary"))
      return "Fire";
    if (lower.includes("decoy grenade") || lower.includes("decoy"))
      return "Decoy";
    return null;
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const label = labelForEntry(item);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    tags.push(label);
  }
  return tags.join(" · ");
}

function sortByTick(rows: number[][]): void {
  rows.sort((a, b) => a[0] - b[0]);
}

/** HUD round-clock pairing — pure transform (no I/O). */
function mergeRoundClockStartsFromLists(
  freezeEnds: DemoEvent[],
  roundStarts: DemoEvent[],
  tickRate: number,
): [number, number][] {
  const FREEZE_FALLBACK_SEC = 15;

  function roundNum(tr: unknown): number {
    if (typeof tr === "number" && Number.isFinite(tr)) return Math.trunc(tr);
    return -1;
  }

  const byRound = new Map<number, number>();

  const freezeTicksSorted: number[] = [];
  for (const ev of freezeEnds) {
    const t = ev.tick;
    if (!Number.isFinite(t)) continue;
    freezeTicksSorted.push(Number(t));
    const rn = roundNum(ev.total_rounds_played);
    if (rn >= 0) {
      const prev = byRound.get(rn);
      if (prev === undefined || Number(t) < prev) byRound.set(rn, Number(t));
    }
  }
  freezeTicksSorted.sort((a, b) => a - b);
  const uniqFreezes = [...new Set(freezeTicksSorted)];

  const earliestStartByRound = new Map<number, number>();
  for (const ev of roundStarts) {
    const t = ev.tick;
    const rn = roundNum(ev.total_rounds_played);
    if (!Number.isFinite(t) || rn < 0) continue;
    const tn = Number(t);
    const prev = earliestStartByRound.get(rn);
    if (prev === undefined || tn < prev) earliestStartByRound.set(rn, tn);
  }

  const starts = [...earliestStartByRound.entries()]
    .map(([round, tick]) => ({ round, tick }))
    .sort((a, b) => a.tick - b.tick);

  const usedFreezes = new Set(byRound.values());

  for (const rs of starts) {
    if (byRound.has(rs.round)) continue;
    let pick: number | undefined;
    for (const t of uniqFreezes) {
      if (t <= rs.tick) continue;
      if (usedFreezes.has(t)) continue;
      pick = t;
      break;
    }
    if (pick !== undefined) {
      usedFreezes.add(pick);
      byRound.set(rs.round, pick);
    }
  }

  for (const rs of starts) {
    if (byRound.has(rs.round)) continue;
    byRound.set(
      rs.round,
      rs.tick + Math.round(FREEZE_FALLBACK_SEC * tickRate),
    );
  }

  return [...byRound.entries()]
    .map(([round, tick]): [number, number] => [tick, round])
    .sort((a, b) => a[0] - b[0]);
}

/** Post-round HUD ticks — pure transform (no I/O). */
function mergeRoundEndsHudFromLists(
  events: DemoEvent[],
  roundClockStarts: [number, number][],
): [number, number][] {
  function roundNum(tr: unknown): number {
    if (typeof tr === "number" && Number.isFinite(tr)) return Math.trunc(tr);
    return -1;
  }

  const byRound = new Map<number, number>();
  for (const ev of events) {
    const t = ev.tick;
    if (!Number.isFinite(t)) continue;
    const rn = roundNum(ev.total_rounds_played);
    if (rn >= 0) {
      const tn = Number(t);
      const prev = byRound.get(rn);
      if (prev === undefined || tn > prev) byRound.set(rn, tn);
    }
  }

  if (byRound.size > 0) {
    return [...byRound.entries()]
      .map(([round, tick]): [number, number] => [tick, round])
      .sort((a, b) => a[0] - b[0]);
  }

  const endTicks: number[] = [];
  for (const ev of events) {
    const t = ev.tick;
    if (Number.isFinite(t)) endTicks.push(Number(t));
  }
  endTicks.sort((a, b) => a - b);

  const liveOrder = [...roundClockStarts]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => Math.trunc(Number(r)));

  const out: [number, number][] = [];
  const n = Math.min(endTicks.length, liveOrder.length);
  for (let i = 0; i < n; i++) {
    out.push([endTicks[i], liveOrder[i]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function forwardFillBalanceSameRound(
  frames: [number, number, (number | string)[][]][],
): void {
  const last = new Map<number, { round: number; balance: number }>();
  for (const fr of frames) {
    const round = fr[1];
    const players = fr[2];
    for (const row of players) {
      if (row.length < 8) continue;
      const idx = Number(row[0]);
      let lb = last.get(idx);
      if (lb && lb.round !== round) last.delete(idx);
      lb = last.get(idx);

      let bal =
        typeof row[5] === "number" && Number.isFinite(row[5])
          ? row[5]
          : Number(row[5]);
      if (!Number.isFinite(bal) || bal < 0) {
        if (lb && lb.round === round && lb.balance >= 0) row[5] = lb.balance;
        bal = Number(row[5]);
      }
      if (Number.isFinite(bal) && bal >= 0) {
        last.set(idx, { round, balance: bal });
      }
    }
  }
}

function rosterFromTickRows(rows: TickRow[]): PlayerMeta[] {
  const seen = new Map<string, { name: string; team: number }>();
  for (const row of rows) {
    const sid = row.steamid;
    if (sid == null) continue;
    const key = String(sid);
    if (!key || seen.has(key)) continue;
    const nameRaw = row.player_name;
    const name =
      typeof nameRaw === "string" ? nameRaw : String(nameRaw ?? "");
    let teamRaw = row.team_num;
    let team: number;
    if (typeof teamRaw === "number" && Number.isFinite(teamRaw)) {
      team = teamRaw;
    } else {
      const n = Number(teamRaw ?? 0);
      team = Number.isFinite(n) ? n : 0;
    }
    seen.set(key, { name, team });
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([steamid, x], i) => ({
      i,
      name: x.name.trim() ? x.name : `#${i}`,
      steamid,
      team: x.team,
    }));
}

function asTickRows(rows: unknown[]): TickRow[] {
  return rows as TickRow[];
}

/**
 * Core export used by the WASM worker. Optionally reusable from Node if bindings implement `parsePlayerInfo`.
 */
export async function buildDemoData(
  buffer: Uint8Array,
  bindings: DemoParserBindings,
  options: BuildDemoDataOptions = {},
): Promise<DemoData> {
  const TICK_STEP = Number(options.tickStep ?? 1);
  const demoLabel = options.demoPathLabel ?? "demo.dem";
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : () => {};
  const yieldFn =
    options.tickYield ??
    (() => new Promise<void>((r) => setTimeout(r, 0)));

  const prog = async (phase: string, pct: number, label: string) => {
    await yieldFn();
    onProgress({ phase, pct, label });
  };

  const { parseHeader, parseTicks, parseEvents } = bindings;

  await prog("header", 7, "Reading header and roster…");
  const header = parseHeader(buffer);

  const BASE_TICK_PROPS = [
    "X",
    "Y",
    "yaw",
    "team_num",
    "is_alive",
    "player_name",
    "game_time",
    "total_rounds_played",
    "balance",
    "active_weapon_name",
  ];

  await prog("ticks", 13, "Running parseTicks…");
  let rows: unknown[];
  try {
    rows = parseTicks(buffer, [...BASE_TICK_PROPS, "inventory"], null, false);
  } catch {
    rows = parseTicks(buffer, BASE_TICK_PROPS, null, false);
  }

  const tickRows = asTickRows(rows);

  const roster: PlayerMeta[] = bindings.parsePlayerInfo
    ? bindings
        .parsePlayerInfo(buffer)
        .sort((a, b) => String(a.steamid).localeCompare(String(b.steamid)))
        .map((p, i) => ({
          i,
          name: p.name,
          steamid: String(p.steamid),
          team: p.team_number,
        }))
    : rosterFromTickRows(tickRows);

  const steamToIdx: Record<string, number> = Object.fromEntries(
    roster.map((p) => [String(p.steamid), p.i]),
  );

  const totalRows = rows.length;
  const ROW_PROGRESS_STEP = Math.max(
    65536,
    Math.floor(totalRows / 48) || 65536,
  );

  await prog("frames", 37, "Building frame samples…");
  let maxTick = 0;
  let minGameTime = Infinity;
  let maxGameTime = -Infinity;

  const byTick = new Map<
    number,
    { round: number; players: (number | string)[][] }
  >();

  for (let i = 0; i < rows.length; i++) {
    const row = tickRows[i];
    if (totalRows > 0 && i > 0 && i % ROW_PROGRESS_STEP === 0) {
      const frac = i / totalRows;
      const pct = 37 + frac * 11;
      await prog(
        "scan_rows",
        pct,
        `Scanning samples ${Math.round(frac * 100)}%…`,
      );
    }

    const t = row.tick;
    if (t % TICK_STEP !== 0) continue;
    if (!row.is_alive) continue;
    const sx = row.X;
    const sy = row.Y;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
    if (Math.abs(sx!) < 2 && Math.abs(sy!) < 2) continue;

    maxTick = Math.max(maxTick, t);

    const gt = row.game_time;
    if (typeof gt === "number" && Number.isFinite(gt)) {
      minGameTime = Math.min(minGameTime, gt);
      maxGameTime = Math.max(maxGameTime, gt);
    }

    const idx = steamToIdx[String(row.steamid)];
    if (idx === undefined) continue;

    let frame = byTick.get(t);
    if (!frame) {
      frame = { round: Number(row.total_rounds_played ?? 0), players: [] };
      byTick.set(t, frame);
    }
    let balRaw = row.balance ?? row.money;
    if (typeof balRaw === "string" && balRaw.trim() !== "") {
      balRaw = Number(balRaw);
    }
    const balance =
      typeof balRaw === "number" && Number.isFinite(balRaw) ? balRaw : -1;
    let gun = "";
    const aw = row.active_weapon_name;
    if (typeof aw === "string") gun = shortenWeapon(aw);
    else if (aw != null && aw !== "") gun = shortenWeapon(String(aw));
    const utils = packUtilityLabels(row);
    const hasBomb = inventoryHasC4(row.inventory) ? 1 : 0;

    frame.players.push([
      idx,
      sx!,
      sy!,
      Number(row.yaw ?? 0),
      Number(row.team_num ?? 0),
      balance,
      gun,
      utils,
      hasBomb,
    ]);
    if (row.total_rounds_played != null) {
      frame.round = Number(row.total_rounds_played);
    }
  }

  if (totalRows > 0) {
    await prog(
      "scan_rows",
      48,
      `Scanning samples 100% (${totalRows.toLocaleString("en-US")} rows)…`,
    );
  }

  await prog("frames_sort", 49, "Sorting timeline frames…");

  const sortedTicks = [...byTick.keys()].sort((a, b) => a - b);
  for (const tick of sortedTicks) {
    const f = byTick.get(tick)!;
    f.players.sort((a, b) => Number(a[0]) - Number(b[0]));
  }
  const frames: [number, number, (number | string)[][]][] = sortedTicks.map(
    (tick) => {
      const f = byTick.get(tick)!;
      return [tick, f.round, f.players];
    },
  );

  forwardFillBalanceSameRound(frames);

  /**
   * Single parseEvents pass for grenades, blinds, weapon_fire, bomb_*.
   * WASM runs a full demo replay per parseEvents call — batching cuts wall time vs ~9 sequential passes.
   * parseTicks remains one thread (no safe concurrency without upstream pthread/SIMD WASM).
   */
  await prog(
    "gameplay_events",
    52,
    "Parsing gameplay events (single WASM pass)…",
  );
  let gameplayEvs: DemoEvent[] = [];
  try {
    gameplayEvs = parseEvents(
      buffer,
      [
        "smokegrenade_detonate",
        "hegrenade_detonate",
        "flashbang_detonate",
        "inferno_startburn",
        "player_blind",
        "weapon_fire",
        "bomb_planted",
        "bomb_exploded",
        "bomb_defused",
        "bomb_dropped",
        "bomb_pickup",
        "player_death",
      ],
      ["X", "Y", "yaw", "pitch"],
      ["attacker_steamid", "weapon", "headshot"],
    ) as DemoEvent[];
  } catch {
    gameplayEvs = [];
  }

  const smokePops: number[][] = [];
  const hePops: number[][] = [];
  const flashPops: number[][] = [];
  const molotovPools: number[][] = [];
  const shots: ShotTupleLike[] = [];
  const utilities: ShotTupleLike[] = [];
  const bombPlants: [number, number, number, number][] = [];
  const bombEnds: [number, "exploded" | "defused"][] = [];
  const bombDrops: [number, number, number][] = [];
  const bombPickupTicks: number[] = [];
  const kills: KillTuple[] = [];

  for (const ev of gameplayEvs) {
    const en = ev.event_name;
    const ex = ev.x;
    const ey = ev.y;
    const thrower =
      steamToIdx[String(ev.user_steamid)] !== undefined
        ? steamToIdx[String(ev.user_steamid)]
        : -1;

    switch (en) {
      case "smokegrenade_detonate":
      case "hegrenade_detonate":
      case "flashbang_detonate":
      case "inferno_startburn": {
        if (!Number.isFinite(ex) || !Number.isFinite(ey)) break;
        const row = [Number(ev.tick), Number(ex), Number(ey), thrower];
        if (en === "smokegrenade_detonate") smokePops.push(row);
        else if (en === "hegrenade_detonate") hePops.push(row);
        else if (en === "flashbang_detonate") flashPops.push(row);
        else molotovPools.push(row);
        break;
      }
      case "weapon_fire": {
        const idx = steamToIdx[String(ev.user_steamid)];
        if (idx === undefined) break;
        const x = ev.user_X;
        const y = ev.user_Y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        const slug = shortenWeapon(ev.weapon);
        const row: (string | number)[] = [
          Number(ev.tick),
          Number(x),
          Number(y),
          idx,
          slug,
        ];
        if (Number.isFinite(ev.user_yaw)) row.push(Number(ev.user_yaw));
        if (Number.isFinite(ev.user_pitch)) row.push(Number(ev.user_pitch));
        if (isGunFireWeapon(ev.weapon)) shots.push(row as ShotTupleLike);
        else if (isUtilityThrowWeapon(ev.weapon))
          utilities.push(row as ShotTupleLike);
        break;
      }
      case "bomb_planted": {
        const ux = ev.user_X;
        const uy = ev.user_Y;
        if (!Number.isFinite(ux) || !Number.isFinite(uy)) break;
        bombPlants.push([
          Number(ev.tick),
          Number(ux),
          Number(uy),
          typeof ev.site === "number" && Number.isFinite(ev.site)
            ? ev.site
            : -1,
        ]);
        break;
      }
      case "bomb_exploded":
        bombEnds.push([Number(ev.tick), "exploded"]);
        break;
      case "bomb_defused":
        bombEnds.push([Number(ev.tick), "defused"]);
        break;
      case "bomb_dropped": {
        const ux = ev.user_X;
        const uy = ev.user_Y;
        if (!Number.isFinite(ux) || !Number.isFinite(uy)) break;
        bombDrops.push([Number(ev.tick), Number(ux), Number(uy)]);
        break;
      }
      case "bomb_pickup": {
        const t = ev.tick;
        if (typeof t === "number" && Number.isFinite(t))
          bombPickupTicks.push(Number(t));
        break;
      }
      case "player_death": {
        const victimIdx = steamToIdx[String(ev.user_steamid)];
        if (victimIdx === undefined) break;
        const vx = ev.user_X;
        const vy = ev.user_Y;
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) break;
        const attackerSid = ev.attacker_steamid;
        const attackerIdx =
          attackerSid !== undefined && attackerSid !== null
            ? (steamToIdx[String(attackerSid)] ?? -1)
            : -1;
        const weapon = shortenWeapon(ev.weapon ?? "unknown");
        const headshot = ev.headshot ? 1 : 0;
        const roundNum = Number(ev.total_rounds_played ?? 0);
        kills.push([
          Number(ev.tick),
          roundNum,
          attackerIdx,
          victimIdx,
          weapon,
          headshot,
          Number(vx),
          Number(vy),
        ]);
        break;
      }
      default:
        break;
    }
  }
  kills.sort((a, b) => a[0] - b[0]);

  sortByTick(smokePops);
  sortByTick(hePops);
  sortByTick(flashPops);
  sortByTick(molotovPools);
  shots.sort((a, b) => a[0] - b[0]);
  utilities.sort((a, b) => a[0] - b[0]);
  sortByTick(bombPlants as unknown as number[][]);
  bombEnds.sort((a, b) => a[0] - b[0]);
  sortByTick(bombDrops as unknown as number[][]);
  bombPickupTicks.sort((a, b) => a - b);

  await prog("flash", 62, "Resolving flashbang victims…");
  const flashVictimAmt = new Map<string, number>();
  for (const b of gameplayEvs) {
    if (b.event_name !== "player_blind") continue;
    const idx = steamToIdx[String(b.user_steamid)];
    if (idx === undefined) continue;
    let amt = 1;
    if (
      typeof b.blind_duration === "number" &&
      Number.isFinite(b.blind_duration)
    ) {
      amt = Math.min(1, Math.max(0, Number(b.blind_duration) / 255));
    } else if (
      typeof b.blind_percentage === "number" &&
      Number.isFinite(b.blind_percentage)
    ) {
      amt = Math.min(1, Math.max(0, Number(b.blind_percentage) / 100));
    }
    const key = `${b.tick}_${idx}`;
    flashVictimAmt.set(key, Math.max(flashVictimAmt.get(key) ?? 0, amt));
  }

  const flashVictims = [...flashVictimAmt.entries()]
    .map(([key, amt]) => {
      const [ts, ix] = key.split("_");
      return [Number(ts), Number(ix), amt] as [number, number, number];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  await prog(
    "round_clock",
    90,
    "Parsing round HUD events (single WASM pass)…",
  );

  await prog("finalize", 97, "Computing tick rate and packing JSON…");
  let tickRate = 64;
  const dur = maxGameTime - minGameTime;
  if (dur > 1 && maxTick > 0) tickRate = maxTick / dur;

  let roundBundle: DemoEvent[] = [];
  try {
    roundBundle = parseEvents(
      buffer,
      [
        "round_freeze_end",
        "round_start",
        "round_end",
        "round_officially_ended",
      ],
      [],
      ["total_rounds_played", "winner", "reason"],
    ) as DemoEvent[];
  } catch {
    roundBundle = [];
  }
  const freezeEnds = roundBundle.filter(
    (e) => e.event_name === "round_freeze_end",
  );
  const roundStarts = roundBundle.filter((e) => e.event_name === "round_start");
  const roundHudEnds = roundBundle.filter(
    (e) =>
      e.event_name === "round_end" ||
      e.event_name === "round_officially_ended",
  );

  const roundClockStarts = mergeRoundClockStartsFromLists(
    freezeEnds,
    roundStarts,
    tickRate,
  );
  const roundEndsHud = mergeRoundEndsHudFromLists(
    roundHudEnds,
    roundClockStarts,
  );

  const roundResults: RoundResultTuple[] = roundHudEnds
    .filter((e) => e.event_name === "round_end")
    .map((e): RoundResultTuple | null => {
      const t = e.tick;
      if (!Number.isFinite(t)) return null;
      const rn = typeof e.total_rounds_played === "number" ? Math.trunc(e.total_rounds_played) : -1;
      if (rn < 0) return null;
      const winner =
        typeof e.winner === "number" && Number.isFinite(e.winner)
          ? Math.trunc(e.winner)
          : 0;
      const reason =
        typeof e.reason === "number" && Number.isFinite(e.reason)
          ? Math.trunc(e.reason)
          : 0;
      return [Number(t), rn, winner, reason];
    })
    .filter((x): x is RoundResultTuple => x !== null)
    .sort((a, b) => a[0] - b[0]);

  return {
    mapName: header.map_name ?? "unknown",
    demoPath: demoLabel,
    tickRate,
    tickStep: TICK_STEP,
    players: roster,
    frames,
    shots: shots as DemoData["shots"],
    utilities: utilities as DemoData["utilities"],
    smokePops: smokePops as DemoData["smokePops"],
    hePops: hePops as DemoData["hePops"],
    flashPops: flashPops as DemoData["flashPops"],
    molotovPools: molotovPools as DemoData["molotovPools"],
    flashVictims,
    bombPlants,
    bombEnds,
    bombDrops,
    bombPickupTicks,
    roundClockStarts,
    roundEndsHud,
    kills: kills as DemoData["kills"],
    roundResults: roundResults as DemoData["roundResults"],
  };
}
