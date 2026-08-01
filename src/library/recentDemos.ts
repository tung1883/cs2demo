export type RecentDemoEntry = {
  id: string;
  label: string;
  mapName: string;
  roundCount: number;
  openedAt: string;
  sourceKind: "url" | "file" | "session";
  url?: string;
};

const STORAGE_KEY = "cs2viewer.recentDemos";
const MAX_ENTRIES = 15;

/** localStorage can throw (private browsing, quota) — every call degrades to a no-op rather than crashing. */
export function loadRecentDemos(): RecentDemoEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentDemoEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveRecentDemo(entry: Omit<RecentDemoEntry, "id" | "openedAt">): void {
  try {
    const id = `${entry.sourceKind}:${entry.url ?? entry.label}:${entry.mapName}`;
    const existing = loadRecentDemos().filter((e) => e.id !== id);
    existing.unshift({ ...entry, id, openedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, MAX_ENTRIES)));
  } catch {
    /* no-op */
  }
}

export function removeRecentDemo(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadRecentDemos().filter((e) => e.id !== id)));
  } catch {
    /* no-op */
  }
}
