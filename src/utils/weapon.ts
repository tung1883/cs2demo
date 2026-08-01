/** Grenades / throwables from weapon_fire (for export + HUD markers). */
export function isUtilityThrowWeapon(weapon: string): boolean {
  const w = weapon.toLowerCase();
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

/** Ballistic weapon_fire (guns / Zeus), excluding grenades, knives, C4, etc. */
export function isGunFireWeapon(weapon: string): boolean {
  const w = weapon.toLowerCase();
  if (!w.startsWith("weapon_")) return false;
  if (w.includes("knife")) return false;
  if (w.includes("bayonet")) return false;
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

export function shortenWeapon(slug: string): string {
  return slug.replace(/^weapon_/, "");
}

/**
 * Approximate CS2 buy-menu prices, keyed by the shortened slug stored in
 * `FramePlayerRow`'s `gun` field (i.e. `weapon_` stripped). Used only for
 * relative economy-bucket comparisons (see `src/analysis/economy.ts`), not
 * displayed as ground truth — armor/kevlar isn't tracked at all (no export
 * field for it), so equip-value estimates under-count by roughly $650-1000
 * per fully-armored player.
 */
export const WEAPON_PRICE: Record<string, number> = {
  ak47: 2700,
  m4a1: 3100,
  m4a1_silencer: 2900,
  awp: 4750,
  deagle: 700,
  glock: 0,
  hkp2000: 0,
  usp_silencer: 0,
  galilar: 1800,
  famas: 2050,
  mp9: 1250,
  mac10: 1050,
  mp7: 1500,
  mp5sd: 1500,
  ump45: 1200,
  p90: 2350,
  bizon: 1400,
  nova: 1050,
  xm1014: 2000,
  sawedoff: 1100,
  mag7: 1300,
  ssg08: 1700,
  scar20: 5000,
  g3sg1: 5000,
  tec9: 500,
  fiveseven: 500,
  p250: 300,
  elite: 800,
  cz75a: 500,
  r8revolver: 600,
  negev: 1700,
  m249: 5200,
  aug: 3300,
  sg556: 3000,
};

/** Utility labels as produced by the exporter's `packUtilityLabels`. */
export const UTILITY_PRICE: Record<string, number> = {
  Smoke: 50,
  Flash: 200,
  HE: 300,
  Fire: 600,
  Decoy: 50,
};
