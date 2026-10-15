/**
 * Weapon / grenade icons (`public/weapons/<file>.svg`, white glyphs on transparent).
 * Demo weapon names arrive either as in-game display names ("AK-47", "Smoke Grenade") from the
 * per-frame roster, or as slugs without the `weapon_` prefix ("smokegrenade") from fire events.
 */

const FILE_BY_LABEL: Record<string, string> = {
  "ak-47": "ak47",
  m4a4: "m4a1",
  "m4a1-s": "m4a1_silencer",
  aug: "aug",
  "sg 553": "sg556",
  "galil ar": "galilar",
  famas: "famas",
  awp: "awp",
  "ssg 08": "ssg08",
  "scar-20": "scar20",
  g3sg1: "g3sg1",
  "desert eagle": "deagle",
  deagle: "deagle",
  "r8 revolver": "revolver",
  "glock-18": "glock",
  "usp-s": "usp_silencer",
  p2000: "hkp2000",
  "five-seven": "fiveseven",
  "tec-9": "tec9",
  "cz75-auto": "cz75a",
  p250: "p250",
  "dual berettas": "elite",
  "mac-10": "mac10",
  mp9: "mp9",
  mp7: "mp7",
  "mp5-sd": "mp5sd",
  "ump-45": "ump45",
  p90: "p90",
  "pp-bizon": "bizon",
  nova: "nova",
  xm1014: "xm1014",
  "sawed-off": "sawedoff",
  "mag-7": "mag7",
  m249: "m249",
  negev: "negev",
  "zeus x27": "taser",
  "c4 explosive": "c4",
  "smoke grenade": "smokegrenade",
  flashbang: "flashbang",
  "high explosive grenade": "hegrenade",
  "he grenade": "hegrenade",
  molotov: "molotov",
  "incendiary grenade": "incgrenade",
  "decoy grenade": "decoy",
  // short labels produced by the exporter's utility packing
  smoke: "smokegrenade",
  flash: "flashbang",
  he: "hegrenade",
  fire: "molotov",
  decoy: "decoy",
};

const KNOWN_FILES = new Set<string>([
  ...new Set(Object.values(FILE_BY_LABEL)),
  "incgrenade",
  "planted_c4",
  "defuser",
  "knife",
]);

const KNIFE_RE = /knife|bayonet|karambit|huntsman|falchion|bowie|butterfly|daggers|navaja|stiletto|ursus|talon|paracord|survival|nomad|skeleton|kukri|flip|gut/i;

/** Icon file (without extension) for a display name or slug, or null if unknown. */
export function weaponIconFile(name: string | undefined | null): string | null {
  if (!name) return null;
  const raw = String(name).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const byLabel = FILE_BY_LABEL[lower];
  if (byLabel) return byLabel;
  const slug = lower.replace(/^weapon_/, "");
  if (KNOWN_FILES.has(slug)) return slug;
  if (KNIFE_RE.test(slug)) return "knife";
  return null;
}

export function weaponIconUrl(name: string | undefined | null): string | null {
  const f = weaponIconFile(name);
  return f ? `/weapons/${f}.svg` : null;
}

const imageCache = new Map<string, HTMLImageElement>();
let onIconLoad: (() => void) | null = null;

/** Called once for every icon that finishes loading (the viewer re-renders from it). */
export function setIconLoadHandler(fn: () => void): void {
  onIconLoad = fn;
}

/** Loaded icon image for canvas drawing, or null while it is still loading / unknown. */
export function loadIcon(name: string | undefined | null): HTMLImageElement | null {
  const file = weaponIconFile(name);
  if (!file) return null;
  let img = imageCache.get(file);
  if (!img) {
    img = new Image();
    img.onload = () => onIconLoad?.();
    img.src = `/weapons/${file}.svg`;
    imageCache.set(file, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
