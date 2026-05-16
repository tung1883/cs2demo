/**
 * Named area bounding boxes for each competitive map.
 * World coordinates from map overview configs (see mapOverview.ts).
 * The "most specific" (smallest) matching area wins when multiple overlap.
 *
 * Coordinates are approximate and calibrated to each map's posX/posY/scale.
 * de_dust2  posX=-2476 posY=3239 scale=4.4
 * de_inferno posX=-2087 posY=3870 scale=4.9
 * de_mirage  posX=-3230 posY=1713 scale=5
 * de_ancient posX=-2953 posY=2164 scale=5
 * de_anubis  posX=-2796 posY=3328 scale=5.22
 * de_nuke    posX=-3453 posY=2887 scale=7
 * de_overpass posX=-4831 posY=1781 scale=5.2
 * de_train   posX=-2477 posY=2392 scale=4.7
 * de_vertigo posX=-3168 posY=1762 scale=4
 */

export type NamedArea = {
  name: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function a(
  name: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): NamedArea {
  return { name, minX, maxX, minY, maxY };
}

export const MAP_POSITIONS: Record<string, NamedArea[]> = {
  de_dust2: [
    a("T Spawn",        400,  1200, -700,  200),
    a("Lower Tunnels",  -100,  900,  200,  900),
    a("Upper Tunnels", -700,   300,  900, 1700),
    a("B Doors",      -1600,  -700, 1100, 1900),
    a("B Platform",   -2300, -1500,  700, 1600),
    a("B Site",       -2400, -1300,  500, 1700),
    a("B Window",     -1800,  -900, 1500, 2100),
    a("Mid / Car",     -600,   300,  200, 1100),
    a("Catwalk",       -800,   100, 1100, 1900),
    a("Xbox / Short",  -200,   700, 1500, 2100),
    a("Long Doors",   -2400, -1600, 1600, 2600),
    a("Long Corner",  -1600,  -800, 1700, 2500),
    a("A Ramp",        -700,   200, 1700, 2500),
    a("A Site",        -900,   300, 2000, 2900),
    a("Goose",          200,   900, 2200, 2900),
    a("Pit",           -900,  -200, 1700, 2400),
    a("CT Spawn",       300,  1300, 1400, 2300),
  ],

  de_inferno: [
    a("T Spawn",       -200,   700, -500,  300),
    a("Banana",       -1700,  -700,  -300,  900),
    a("B Site",       -2100, -1100,  700, 1800),
    a("B Apartments", -1500,  -400, 1400, 2400),
    a("Mid / Overpass",-900,   200, 1200, 2700),
    a("Second Mid",    -900,   200, 2400, 3200),
    a("CT Spawn",       700,  1900, 2600, 3700),
    a("A Balcony",     -700,   300, 2500, 3300),
    a("A Long",       -1000,   200, 2500, 3600),
    a("A Site",        -400,   800, 2600, 3600),
    a("Arch / Short",   200,  1100, 1900, 2900),
    a("Library",        100,   900, 2500, 3300),
  ],

  de_mirage: [
    a("T Spawn",      -2200, -1100, -3300, -2100),
    a("T Ramp (A)",   -1900,  -800, -2800, -1700),
    a("Mid / Stairs", -2200, -1100, -2300, -1200),
    a("Top Mid",      -2000,  -900, -1900,  -800),
    a("CT Mid",       -1600,  -400, -1500,  -400),
    a("A Short",      -1300,  -200, -1800,  -700),
    a("A Site",       -1500,  -300,  -900,   200),
    a("Jungle",       -1200,  -100, -1700,  -600),
    a("CT Spawn",      -900,   400, -1100,   100),
    a("B Apartments", -3200, -2100, -1200,   100),
    a("B Short",      -3000, -1800,  -900,   100),
    a("B Site",       -3200, -2000,  -300,   900),
    a("Connector",    -2200, -1100, -1500,  -400),
  ],

  de_ancient: [
    a("T Spawn",      -2000,  -900, -3700, -2500),
    a("A Main",       -2300, -1000, -2800, -1500),
    a("A Ruins",      -1700,  -500, -2000,  -700),
    a("A Site",       -1500,  -300, -1700,  -300),
    a("Mid",          -2200,  -800, -2600, -1200),
    a("Cave (B)",     -2900, -1800, -1900,  -700),
    a("B Main",       -2900, -1700, -2600, -1200),
    a("B Site",       -2900, -1600, -2200,  -800),
    a("CT Spawn",      -200,  1200, -1600,  -100),
    a("CT Alley",     -1200,   200, -1200,   100),
  ],

  de_anubis: [
    a("T Spawn",      -1900,  -700, -3000, -1900),
    a("A Main",       -1500,  -300, -1800,  -500),
    a("A Palace",     -2000,  -800, -1500,  -200),
    a("A Site",       -1300,   100, -1100,   400),
    a("Mid",          -2000,  -600, -2200,  -800),
    a("B Main",       -2900, -1500, -2500, -1000),
    a("B Site",       -2900, -1500, -2200,  -800),
    a("B Canal",      -2500, -1200, -2900, -1600),
    a("CT Spawn",      -100,  1400, -1100,   300),
    a("Connector",    -1500,  -300, -1600,  -300),
  ],

  de_nuke: [
    a("T Spawn",      -1300,   300, -4100, -2700),
    a("Outside",      -3500, -1900, -2900, -1200),
    a("T Roof / Silo",-2500, -1000, -2000,  -400),
    a("Heaven (A)",   -1600,   200,  -900,   600),
    a("Upper A Site", -2300,  -700, -1700,  -100),
    a("Lower A Site", -2400,  -800, -600,   900),
    a("CT Lobby",     -1300,   400,  -700,   900),
    a("Ramp (B)",      400,  1800, -3100, -1700),
    a("Upper B",       300,  1900, -2300,  -700),
    a("Lower B",       300,  1900,  -800,   900),
    a("Garage",       -1000,   600,  700,  2000),
    a("CT Roof",      -1500,   300,  600,  1800),
  ],

  de_overpass: [
    a("T Spawn",      -4200, -2600, -3400, -2000),
    a("T Mid",        -3600, -2200, -2800, -1500),
    a("Connector",    -3200, -2000, -2600, -1300),
    a("Short (A)",    -2700, -1600, -1600,  -300),
    a("A Site",       -2600, -1300, -1500,   100),
    a("Long (A)",     -4200, -2700, -1500,   200),
    a("CT Spawn",     -1900,  -500,  -900,   500),
    a("Under / B",    -4800, -3400, -1900,  -400),
    a("B Site",       -4800, -3500, -2100,  -600),
    a("Playground",   -3900, -2600,  -900,   400),
    a("Fountain / Mid",-3300,-2000, -2000,  -600),
    a("Channel",      -4500, -3200,  -900,   600),
  ],

  de_train: [
    a("T Spawn",      -2400, -1100, -2300, -1100),
    a("Ivy",          -2300, -1000, -1100,   300),
    a("Upper Ivy",    -2100,  -800,   300,  1500),
    a("E Box / Mid",  -1300,   100,  -900,   300),
    a("Ladder / Z",    -600,   600,  -500,   700),
    a("B Site",       -2200,  -800,  -700,   600),
    a("A Site",        -700,   700,  -700,   700),
    a("Popdog",        -500,   700,   700,  1800),
    a("CT Spawn",       400,  1700,  -700,   700),
    a("Heaven (A)",    -700,   600,   100,  1300),
    a("T Connector",  -1500,  -200,  -1600, -400),
  ],

  de_vertigo: [
    a("T Spawn",      -2900, -1800, -2200, -1100),
    a("T Mid",        -2500, -1400, -1600,  -600),
    a("A Ramp",       -3100, -1800,  -900,   100),
    a("A Site",       -3000, -1700, -1100,   100),
    a("A Scaffold",   -2000,  -800,  -700,   300),
    a("B Ramp",       -1800,  -500,  -900,   100),
    a("B Site",       -1700,  -400, -1100,   100),
    a("CT Spawn",      -900,   600,  -700,   300),
    a("Mid",          -2200, -1000, -1800,  -500),
  ],
};

/**
 * Returns the most-specific (smallest area) named area for world position (x, y) on the given map.
 */
export function getPositionName(
  mapName: string,
  x: number,
  y: number,
): string | undefined {
  const areas = MAP_POSITIONS[mapName];
  if (!areas) return undefined;
  let best: NamedArea | undefined;
  let bestSize = Infinity;
  for (const area of areas) {
    if (x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY) {
      const size = (area.maxX - area.minX) * (area.maxY - area.minY);
      if (size < bestSize) {
        best = area;
        bestSize = size;
      }
    }
  }
  return best?.name;
}
