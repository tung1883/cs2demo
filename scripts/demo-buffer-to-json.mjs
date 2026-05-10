/**
 * Shared CS2 demo → viewer JSON (buffer in / JSON out).
 * Used by export-demo.mjs and the Vite /api/export-dem upload handler.
 */
import {
  parseTicks,
  parsePlayerInfo,
  parseHeader,
  parseEvent,
  parseEvents,
} from "@laihoe/demoparser2";

function isUtilityThrowWeapon(weapon) {
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

function isGunFireWeapon(weapon) {
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

function shortenWeapon(slug) {
  return String(slug).replace(/^weapon_/, "");
}

function inventoryHasC4(inv) {
  if (!Array.isArray(inv)) return false;
  return inv.some((item) => {
    const w =
      typeof item === "object" && item != null
        ? item.name ?? item.weapon ?? item.classname ?? ""
        : item;
    const s = String(w).toLowerCase();
    return s.includes("c4") || s === "weapon_c4";
  });
}

/**
 * Grenade labels from tick `inventory` / `weapons`.
 * CS2 often returns pretty names: ["M4A4","Smoke Grenade","Flashbang"] — not weapon_* slugs.
 */
function packUtilityLabels(row) {
  const raw = row.inventory ?? row.weapons;
  if (raw == null || raw === "") return "";
  /** @type {unknown[]} */
  let items = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      items = Array.isArray(j) ? j : [raw];
    } catch {
      items = raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } else if (typeof raw === "object") {
    items = Object.values(raw);
  }

  /** @param {unknown} entry */
  function labelForEntry(entry) {
    const w =
      typeof entry === "object" && entry != null
        ? entry.weapon ?? entry.name ?? entry.classname ?? ""
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

  const tags = [];
  const seen = new Set();
  for (const item of items) {
    const label = labelForEntry(item);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    tags.push(label);
  }
  return tags.join(" · ");
}

/** @param {number[][]} rows */
function sortByTick(rows) {
  rows.sort((a, b) => a[0] - b[0]);
}

/**
 * HUD round clock starts when freeze ends (`round_freeze_end`). Demos often omit
 * `total_rounds_played` on freeze events — pair with `round_start` by tick order.
 * @param {Buffer} buffer
 * @param {number} tickRate
 * @returns {[number, number][]}
 */
function mergeRoundClockStarts(buffer, tickRate) {
  /** Competitive freeze length when freeze_end is missing (seconds). */
  const FREEZE_FALLBACK_SEC = 15;

  /** @param {unknown} tr */
  function roundNum(tr) {
    if (typeof tr === "number" && Number.isFinite(tr)) return Math.trunc(tr);
    return -1;
  }

  let freezeEnds = [];
  let roundStarts = [];
  try {
    freezeEnds = parseEvents(
      buffer,
      ["round_freeze_end"],
      [],
      ["total_rounds_played"],
    );
  } catch {
    freezeEnds = [];
  }
  try {
    roundStarts = parseEvents(buffer, ["round_start"], [], [
      "total_rounds_played",
    ]);
  } catch {
    roundStarts = [];
  }

  /** @type {Map<number, number>} */
  const byRound = new Map();

  const freezeTicksSorted = [];
  for (const ev of freezeEnds) {
    const t = ev.tick;
    if (!Number.isFinite(t)) continue;
    freezeTicksSorted.push(t);
    const rn = roundNum(ev.total_rounds_played);
    if (rn >= 0) {
      const prev = byRound.get(rn);
      if (prev === undefined || t < prev) byRound.set(rn, t);
    }
  }
  freezeTicksSorted.sort((a, b) => a - b);
  const uniqFreezes = [...new Set(freezeTicksSorted)];

  /** Earliest `round_start` tick per logical round */
  const earliestStartByRound = new Map();
  for (const ev of roundStarts) {
    const t = ev.tick;
    const rn = roundNum(ev.total_rounds_played);
    if (!Number.isFinite(t) || rn < 0) continue;
    const prev = earliestStartByRound.get(rn);
    if (prev === undefined || t < prev) earliestStartByRound.set(rn, t);
  }

  const starts = [...earliestStartByRound.entries()]
    .map(([round, tick]) => ({ round, tick }))
    .sort((a, b) => a.tick - b.tick);

  const usedFreezes = new Set(byRound.values());

  for (const rs of starts) {
    if (byRound.has(rs.round)) continue;
    let pick = undefined;
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
    .map(([round, tick]) => /** @type {[number, number]} */ ([tick, round]))
    .sort((a, b) => a[0] - b[0]);
}

/**
 * When the HUD round clock stops (win / time / etc.) — before next round freeze ends.
 * @param {Buffer} buffer
 * @param {[number, number][]} roundClockStarts
 * @returns {[number, number][]}
 */
function mergeRoundEndsHud(buffer, roundClockStarts) {
  /** @param {unknown} tr */
  function roundNum(tr) {
    if (typeof tr === "number" && Number.isFinite(tr)) return Math.trunc(tr);
    return -1;
  }

  let events = [];
  try {
    events = parseEvents(
      buffer,
      ["round_end", "round_officially_ended"],
      [],
      ["total_rounds_played"],
    );
  } catch {
    events = [];
  }

  /** @type {Map<number, number>} */
  const byRound = new Map();
  for (const ev of events) {
    const t = ev.tick;
    if (!Number.isFinite(t)) continue;
    const rn = roundNum(ev.total_rounds_played);
    if (rn >= 0) {
      const prev = byRound.get(rn);
      if (prev === undefined || t > prev) byRound.set(rn, t);
    }
  }

  if (byRound.size > 0) {
    return [...byRound.entries()]
      .map(([round, tick]) => /** @type {[number, number]} */ ([tick, round]))
      .sort((a, b) => a[0] - b[0]);
  }

  const endTicks = [];
  for (const ev of events) {
    const t = ev.tick;
    if (Number.isFinite(t)) endTicks.push(t);
  }
  endTicks.sort((a, b) => a - b);

  const liveOrder = [...roundClockStarts]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => Math.trunc(Number(r)));

  /** @type {[number, number][]} */
  const out = [];
  const n = Math.min(endTicks.length, liveOrder.length);
  for (let i = 0; i < n; i++) {
    out.push([endTicks[i], liveOrder[i]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Demo ticks occasionally omit `balance` even when the player is alive.
 * Carry the last valid cash within the same round so the roster doesn't flicker "—".
 */
function forwardFillBalanceSameRound(frames) {
  /** @type {Map<number, { round: number, balance: number }>} */
  const last = new Map();
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

function tickYield() {
  return new Promise((r) => setImmediate(r));
}

/**
 * @param {Buffer} buffer
 * @param {{ demoPathLabel?: string, tickStep?: number, onProgress?: (e: { phase: string, pct: number, label: string }) => void }} [options]
 */
export async function exportDemoBuffer(buffer, options = {}) {
  const TICK_STEP = Number(
    options.tickStep ?? process.env.TICK_STEP ?? 1,
  );
  const demoLabel = options.demoPathLabel ?? "demo.dem";
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : () => {};
  const prog = async (phase, pct, label) => {
    await tickYield();
    onProgress({ phase, pct, label });
  };

  await prog("header", 7, "Reading header and roster…");
  const header = parseHeader(buffer);
  const roster = parsePlayerInfo(buffer).sort((a, b) =>
    String(a.steamid).localeCompare(String(b.steamid)),
  );
  const steamToIdx = Object.fromEntries(
    roster.map((p, i) => [String(p.steamid), i]),
  );

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

  await prog("ticks", 13, "Running native parseTicks…");
  let rows;
  try {
    rows = parseTicks(buffer, [...BASE_TICK_PROPS, "inventory"], null, null, false);
  } catch {
    rows = parseTicks(buffer, BASE_TICK_PROPS, null, null, false);
  }

  const totalRows = rows.length;
  const ROW_PROGRESS_STEP = Math.max(
    65536,
    Math.floor(totalRows / 48) || 65536,
  );

  await prog("frames", 37, "Building frame samples…");
  let maxTick = 0;
  let minGameTime = Infinity;
  let maxGameTime = -Infinity;

  /** @type {Map<number, { round: number, players: (number|string)[][] }>} */
  const byTick = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
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
    if (Math.abs(sx) < 2 && Math.abs(sy) < 2) continue;

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
      frame = { round: row.total_rounds_played ?? 0, players: [] };
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
      sx,
      sy,
      row.yaw ?? 0,
      row.team_num ?? 0,
      balance,
      gun,
      utils,
      hasBomb,
    ]);
    if (row.total_rounds_played != null) {
      frame.round = row.total_rounds_played;
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
    const f = byTick.get(tick);
    f.players.sort((a, b) => a[0] - b[0]);
  }
  const frames = sortedTicks.map((tick) => {
    const f = byTick.get(tick);
    return [tick, f.round, f.players];
  });

  forwardFillBalanceSameRound(frames);

  await prog("grenades", 52, "Parsing grenade detonations…");
  // Smoke: detonation XY only — viewer shows a timed marker, not engine voxel state.
  const grenadeEvents = parseEvents(
    buffer,
    [
      "smokegrenade_detonate",
      "hegrenade_detonate",
      "flashbang_detonate",
      "inferno_startburn",
    ],
    ["X", "Y"],
    [],
  );

  const smokePops = [];
  const hePops = [];
  const flashPops = [];
  const molotovPools = [];

  for (const ev of grenadeEvents) {
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y)) continue;
    const thrower =
      steamToIdx[String(ev.user_steamid)] !== undefined
        ? steamToIdx[String(ev.user_steamid)]
        : -1;
    const row = [ev.tick, ev.x, ev.y, thrower];
    switch (ev.event_name) {
      case "smokegrenade_detonate":
        smokePops.push(row);
        break;
      case "hegrenade_detonate":
        hePops.push(row);
        break;
      case "flashbang_detonate":
        flashPops.push(row);
        break;
      case "inferno_startburn":
        molotovPools.push(row);
        break;
      default:
        break;
    }
  }

  sortByTick(smokePops);
  sortByTick(hePops);
  sortByTick(flashPops);
  sortByTick(molotovPools);

  await prog("flash", 62, "Parsing flashbang / blind events…");
  /** @type {Map<string, number>} */
  const flashVictimAmt = new Map();
  try {
    const blinds = parseEvent(buffer, "player_blind", ["X", "Y"], []);
    for (const b of blinds) {
      const idx = steamToIdx[String(b.user_steamid)];
      if (idx === undefined) continue;
      let amt = 1;
      if (typeof b.blind_duration === "number" && Number.isFinite(b.blind_duration)) {
        amt = Math.min(1, Math.max(0, b.blind_duration / 255));
      } else if (
        typeof b.blind_percentage === "number" &&
        Number.isFinite(b.blind_percentage)
      ) {
        amt = Math.min(1, Math.max(0, b.blind_percentage / 100));
      }
      const key = `${b.tick}_${idx}`;
      flashVictimAmt.set(key, Math.max(flashVictimAmt.get(key) ?? 0, amt));
    }
  } catch {
    /* event missing in some demos */
  }

  const flashVictims = [...flashVictimAmt.entries()]
    .map(([key, amt]) => {
      const [ts, ix] = key.split("_");
      return [Number(ts), Number(ix), amt];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  await prog("fires", 72, "Parsing weapon_fire…");
  const fires = parseEvent(buffer, "weapon_fire", ["X", "Y", "yaw", "pitch"]);
  const shots = [];
  const utilities = [];
  for (const ev of fires) {
    const idx = steamToIdx[String(ev.user_steamid)];
    if (idx === undefined) continue;
    const x = ev.user_X;
    const y = ev.user_Y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const slug = shortenWeapon(ev.weapon);
    /** @type {(string|number)[]} */
    const row = [ev.tick, x, y, idx, slug];
    if (Number.isFinite(ev.user_yaw)) row.push(ev.user_yaw);
    if (Number.isFinite(ev.user_pitch)) row.push(ev.user_pitch);
    if (isGunFireWeapon(ev.weapon)) shots.push(row);
    else if (isUtilityThrowWeapon(ev.weapon)) utilities.push(row);
  }
  shots.sort((a, b) => a[0] - b[0]);
  utilities.sort((a, b) => a[0] - b[0]);

  await prog("bombs", 82, "Parsing bomb events…");
  const bombPlantedEvs = parseEvents(buffer, ["bomb_planted"], ["X", "Y"], []);
  const bombExplodedEvs = parseEvents(buffer, ["bomb_exploded"], [], []);
  const bombDefusedEvs = parseEvents(buffer, ["bomb_defused"], [], []);
  const bombDroppedEvs = parseEvents(buffer, ["bomb_dropped"], ["X", "Y"], []);
  const bombPickupEvs = parseEvents(buffer, ["bomb_pickup"], ["X", "Y"], []);

  const bombPlants = [];
  for (const ev of bombPlantedEvs) {
    if (!Number.isFinite(ev.user_X) || !Number.isFinite(ev.user_Y)) continue;
    bombPlants.push([
      ev.tick,
      ev.user_X,
      ev.user_Y,
      typeof ev.site === "number" && Number.isFinite(ev.site) ? ev.site : -1,
    ]);
  }
  sortByTick(bombPlants);

  const bombEnds = [];
  for (const ev of bombExplodedEvs) {
    bombEnds.push([ev.tick, "exploded"]);
  }
  for (const ev of bombDefusedEvs) {
    bombEnds.push([ev.tick, "defused"]);
  }
  bombEnds.sort((a, b) => a[0] - b[0]);

  const bombDrops = [];
  for (const ev of bombDroppedEvs) {
    if (!Number.isFinite(ev.user_X) || !Number.isFinite(ev.user_Y)) continue;
    bombDrops.push([ev.tick, ev.user_X, ev.user_Y]);
  }
  sortByTick(bombDrops);

  const bombPickupTicks = bombPickupEvs
    .map((e) => e.tick)
    .filter((t) => typeof t === "number" && Number.isFinite(t))
    .sort((a, b) => a - b);

  await prog("round_clock", 90, "Parsing round freeze / clock events…");

  await prog("finalize", 97, "Computing tick rate and packing JSON…");
  let tickRate = 64;
  const dur = maxGameTime - minGameTime;
  if (dur > 1 && maxTick > 0) tickRate = maxTick / dur;

  const roundClockStarts = mergeRoundClockStarts(buffer, tickRate);
  const roundEndsHud = mergeRoundEndsHud(buffer, roundClockStarts);

  return {
    mapName: header.map_name ?? "unknown",
    demoPath: demoLabel,
    tickRate,
    tickStep: TICK_STEP,
    players: roster.map((p, i) => ({
      i,
      name: p.name,
      steamid: String(p.steamid),
      team: p.team_number,
    })),
    frames,
    shots,
    utilities,
    smokePops,
    hePops,
    flashPops,
    molotovPools,
    flashVictims,
    bombPlants,
    bombEnds,
    bombDrops,
    bombPickupTicks,
    roundClockStarts,
    roundEndsHud,
  };
}
