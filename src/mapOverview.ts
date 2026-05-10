/**
 * Matches `resource/overviews/<map>.txt` in CS2 — use with a square PNG
 * exported from panorama/overheadmaps (same geometry as in-game radar art).
 */

export type MapOverviewConfig = {
  /** In-game map name, e.g. de_dust2 */
  mapName: string;
  /** World X at overview top-left pixel */
  posX: number;
  /** World Y at overview top-left pixel (Source Y flipped when mapping) */
  posY: number;
  /** World units per pixel (typical PNG is 1024×1024) */
  scale: number;
  overviewPx: number;
};

export const KNOWN_MAP_OVERVIEWS: Record<string, MapOverviewConfig> = {
  de_dust2: {
    mapName: "de_dust2",
    posX: -2476,
    posY: 3239,
    scale: 4.4,
    overviewPx: 1024,
  },
  de_inferno: {
    mapName: "de_inferno",
    posX: -2087,
    posY: 3870,
    scale: 4.9,
    overviewPx: 1024,
  },
  de_mirage: {
    mapName: "de_mirage",
    posX: -3230,
    posY: 1713,
    scale: 5,
    overviewPx: 1024,
  },
  /** Geometry from `resource/overviews/*.txt` (same keys as HLTV / demoinfocs examples). */
  de_ancient: {
    mapName: "de_ancient",
    posX: -2953,
    posY: 2164,
    scale: 5,
    overviewPx: 1024,
  },
  de_anubis: {
    mapName: "de_anubis",
    posX: -2796,
    posY: 3328,
    scale: 5.22,
    overviewPx: 1024,
  },
  de_nuke: {
    mapName: "de_nuke",
    posX: -3453,
    posY: 2887,
    scale: 7,
    overviewPx: 1024,
  },
  de_overpass: {
    mapName: "de_overpass",
    posX: -4831,
    posY: 1781,
    scale: 5.2,
    overviewPx: 1024,
  },
  de_train: {
    mapName: "de_train",
    posX: -2477,
    posY: 2392,
    scale: 4.7,
    overviewPx: 1024,
  },
  de_vertigo: {
    mapName: "de_vertigo",
    posX: -3168,
    posY: 1762,
    scale: 4,
    overviewPx: 1024,
  },
};

export function getMapOverview(mapName: string): MapOverviewConfig | undefined {
  return KNOWN_MAP_OVERVIEWS[mapName];
}
