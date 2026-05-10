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
